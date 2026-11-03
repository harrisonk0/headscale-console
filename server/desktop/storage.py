"""Private roaming-disk store. Bind to loopback behind the authenticated bridge.

Immutable, content-addressed records plus an atomic manifest make interrupted
uploads harmless. A fenced lease prevents an old browser overwriting a takeover.
No guest paths are interpreted as host filesystem paths.
"""
import hashlib
import json
import secrets
import sqlite3
import time


class Conflict(Exception):
    pass


class Store:
    def __init__(self, path, clock=time.time):
        self.clock = clock
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),
            revision INTEGER NOT NULL, manifest TEXT NOT NULL,
            lease TEXT NOT NULL, session TEXT NOT NULL, expires REAL NOT NULL);
          INSERT OR IGNORE INTO state VALUES(1,0,'null','','',0);
          CREATE TABLE IF NOT EXISTS chunks(hash TEXT PRIMARY KEY,data BLOB NOT NULL);
          CREATE TABLE IF NOT EXISTS history(revision INTEGER PRIMARY KEY,manifest TEXT NOT NULL);
          INSERT OR IGNORE INTO history SELECT revision,manifest FROM state WHERE revision>0 AND manifest!='null';
        """)

    def claim(self, session, takeover=False):
        with self.db:
            row = self.db.execute("SELECT revision,manifest,lease,session,expires FROM state").fetchone()
            if row[4] > self.clock() and not takeover:
                raise Conflict("Desktop is open elsewhere. Choose Move here to take over.")
            lease = secrets.token_hex(32)
            self.db.execute("UPDATE state SET lease=?,session=?,expires=?", (lease, session, self.clock()+90))
            return dict(lease=lease, revision=row[0], manifest=json.loads(row[1]))

    def check(self, session, lease):
        row = self.db.execute("SELECT revision,session,lease,expires FROM state").fetchone()
        if not secrets.compare_digest(row[1], session) or not secrets.compare_digest(row[2], lease) or row[3] <= self.clock():
            raise Conflict("Desktop session ended or moved to another computer.")
        return row[0]

    def heartbeat(self, session, lease):
        with self.db:
            self.check(session, lease)
            self.db.execute("UPDATE state SET expires=?", (self.clock()+90,))
        return {"ok": True}

    def put(self, session, lease, key, data):
        with self.db:
            self.check(session, lease)
            if len(data) > 2*1024*1024 or hashlib.sha256(data).hexdigest() != key:
                raise ValueError("Invalid disk record")
            if self.db.execute("SELECT 1 FROM chunks WHERE hash=?", (key,)).fetchone():
                return {"ok": True}
            used = self.db.execute("SELECT COALESCE(SUM(length(data)),0) FROM chunks").fetchone()[0]
            if used + len(data) > 4*1024*1024*1024:
                raise ValueError("Desktop save quota reached")
            self.db.execute("INSERT OR IGNORE INTO chunks VALUES(?,?)", (key, data))
        return {"ok": True}

    def begin(self, session, lease):
        with self.db:
            revision = self.check(session, lease)
            self.db.execute("DELETE FROM chunks WHERE hash NOT IN (SELECT value FROM history, json_each(history.manifest,'$.chunks'))")
            manifest = self.db.execute("SELECT manifest FROM state").fetchone()[0]
        return {"revision": revision, "manifest": json.loads(manifest)}

    def read(self, session, lease, key):
        self.check(session, lease)
        row = self.db.execute("SELECT data FROM chunks WHERE hash=?", (key,)).fetchone()
        if row is None:
            raise ValueError("Disk record missing")
        return row[0]

    def commit(self, session, lease, revision, manifest):
        encoded = json.dumps(manifest, separators=(',', ':'))
        if len(encoded) > 8*1024*1024 or not isinstance(manifest, dict):
            raise ValueError("Invalid manifest")
        if manifest.get('format') != 'hk-desktop-idb-v1' or not isinstance(manifest.get('chunks'), list):
            raise ValueError("Unknown disk format")
        if len(manifest['chunks']) > 200000 or any(not isinstance(k, str) or len(k) != 64 for k in manifest['chunks']):
            raise ValueError("Invalid record list")
        with self.db:
            current = self.check(session, lease)
            if revision != current:
                raise Conflict("Save revision changed. Refusing to overwrite newer data.")
            for key in manifest['chunks']:
                if self.db.execute("SELECT 1 FROM chunks WHERE hash=?", (key,)).fetchone() is None:
                    raise ValueError("Upload incomplete; previous save is unchanged")
            self.db.execute("UPDATE state SET revision=?,manifest=?,expires=?", (current+1, encoded, self.clock()+90))
            self.db.execute("INSERT OR REPLACE INTO history VALUES(?,?)", (current+1, encoded))
            self.db.execute("DELETE FROM history WHERE revision < ?", (current-1,))
            # Bound storage over time, retaining three complete checkpoints.
            # Pending uploads are safe to prune: this single-writer lease's
            # entire next manifest is uploaded before an atomic commit.
            self.db.execute("DELETE FROM chunks WHERE hash NOT IN (SELECT value FROM history, json_each(history.manifest,'$.chunks'))")
        return {"revision": current+1}

    def resume(self, session, lease):
        with self.db:
            row = self.db.execute("SELECT lease FROM state").fetchone()
            if not lease or not secrets.compare_digest(row[0], lease):
                raise Conflict("Desktop moved elsewhere. Reopen it before continuing.")
            self.db.execute("UPDATE state SET session=?,expires=?", (session, self.clock()+90))
        return {"ok": True}

    def release(self, session, lease):
        with self.db:
            self.check(session, lease)
            self.db.execute("UPDATE state SET expires=0,lease='',session=''")
        return {"ok": True}
