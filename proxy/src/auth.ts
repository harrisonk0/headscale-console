import { DurableObject } from "cloudflare:workers";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const hex = (v: Uint8Array) => Buffer.from(v).toString("hex");
const random = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex"));
// Cloudflare production caps native PBKDF2 at 100,000 rounds. The portable
// implementation preserves the full 600,000-round derivation and stored format.
const passwordHash = async (p: string, salt: string) =>
  hex(
    await pbkdf2Async(sha256, new TextEncoder().encode(p), Buffer.from(salt, "hex"), {
      c: 600000,
      dkLen: 32,
      asyncTick: 20,
    }),
  );
function base32(bytes: Uint8Array) {
  let bits = 0,
    value = 0,
    out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[(value << (5 - bits)) & 31];
  return out;
}
function decode32(text: string) {
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const n = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch);
    if (n < 0) throw new Error("Invalid secret");
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function otp(seed: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", decode32(seed)).update(counter).digest();
  const offset = h[h.length - 1] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
function validStep(seed: string, code: string) {
  const step = Math.floor(Date.now() / 30000);
  for (const n of [step, step - 1, step + 1]) if (equal(otp(seed, n), code)) return n;
  return -1;
}
export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`AUTH_${status}: ${message}`);
  }
}
type AuthRow = { salt: string; password_hash: string; seed: string; last_step: number };
type SessionRow = { hash: string; kind: string; expires: number; parent: string; joins: number };

/** One coordinator per owner: atomic OTP consumption and bounded login attempts. */
export class AuthGuard extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS auth(id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL,password_hash TEXT NOT NULL,seed TEXT NOT NULL,last_step INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pending(id INTEGER PRIMARY KEY CHECK(id=1),seed TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,kind TEXT NOT NULL,expires INTEGER NOT NULL,parent TEXT NOT NULL,joins INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS tickets(hash TEXT PRIMARY KEY,parent TEXT NOT NULL,expires INTEGER NOT NULL,target TEXT NOT NULL DEFAULT 'dashboard');
      CREATE TABLE IF NOT EXISTS recovery(hash TEXT PRIMARY KEY,used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS limits(name TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);`);
    const columns = ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(tickets)").toArray();
    if (!columns.some((c) => c.name === "target"))
      ctx.storage.sql.exec(
        "ALTER TABLE tickets ADD COLUMN target TEXT NOT NULL DEFAULT 'dashboard'",
      );
  }
  private row() {
    return this.ctx.storage.sql
      .exec<AuthRow>("SELECT salt,password_hash,seed,last_step FROM auth WHERE id=1")
      .toArray()[0];
  }
  private requireBootstrap(token: string) {
    if (this.row()) throw new AuthError(409, "Setup has already been completed.");
    if (Date.now() > Number(this.env.SETUP_EXPIRES_AT) || !equal(token, this.env.SETUP_TOKEN))
      throw new AuthError(403, "This setup link is invalid or expired.");
  }
  private async seal(seed: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(Buffer.from(this.env.AUTH_ENCRYPTION_KEY, "hex")),
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(seed),
    );
    return `${hex(iv)}.${Buffer.from(ciphertext).toString("hex")}`;
  }
  private async unseal(value: string) {
    const [iv, cipher] = value.split(".");
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(Buffer.from(this.env.AUTH_ENCRYPTION_KEY, "hex")),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(Buffer.from(iv, "hex")) },
      key,
      new Uint8Array(Buffer.from(cipher, "hex")),
    );
    return new TextDecoder().decode(plain);
  }
  private reserveAttempt(ip: string) {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM limits WHERE reset<?", now);
      for (const [key, max] of [
        ["owner", 20],
        ["ip:" + digest(ip), 5],
      ] as const) {
        const current = this.ctx.storage.sql
          .exec<{ count: number; reset: number }>(
            "SELECT count,reset FROM limits WHERE name=?",
            key,
          )
          .toArray()[0];
        if (current && current.count >= max)
          throw new AuthError(429, "Too many attempts. Wait ten minutes before trying again.");
        this.ctx.storage.sql.exec(
          "INSERT INTO limits(name,count,reset) VALUES(?,1,?) ON CONFLICT(name) DO UPDATE SET count=count+1",
          key,
          now + 600000,
        );
      }
    });
  }
  private session(token: string, kind: string) {
    const row = this.ctx.storage.sql
      .exec<SessionRow>("SELECT * FROM sessions WHERE hash=?", digest(token))
      .toArray()[0];
    if (!row || row.kind !== kind || row.expires <= Date.now()) return undefined;
    if (row.parent) {
      const parent = this.ctx.storage.sql
        .exec<{ expires: number }>("SELECT expires FROM sessions WHERE hash=?", row.parent)
        .toArray()[0];
      if (!parent || parent.expires <= Date.now()) return undefined;
    }
    return row;
  }
  async status(token: string) {
    return { configured: !!this.row(), authenticated: !!this.session(token, "remote") };
  }
  async beginSetup(token: string) {
    this.requireBootstrap(token);
    let p = this.ctx.storage.sql
      .exec<{ seed: string; expires: number }>("SELECT seed,expires FROM pending WHERE id=1")
      .toArray()[0];
    if (!p || p.expires < Date.now()) {
      const seed = base32(crypto.getRandomValues(new Uint8Array(20)));
      const encrypted = await this.seal(seed);
      this.requireBootstrap(token);
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO pending(id,seed,expires) VALUES(1,?,?)",
        encrypted,
        Date.now() + 600000,
      );
      p = { seed: encrypted, expires: Date.now() + 600000 };
    }
    const secret = await this.unseal(p.seed);
    return {
      secret,
      uri: `otpauth://totp/HK%20Remote:harrison?secret=${secret}&issuer=HK%20Remote&algorithm=SHA1&digits=6&period=30`,
    };
  }
  async finishSetup(token: string, password: string, code: string) {
    this.requireBootstrap(token);
    if (password.length < 12 || password.length > 256)
      throw new AuthError(400, "Use a password between 12 and 256 characters.");
    const p = this.ctx.storage.sql
      .exec<{ seed: string; expires: number }>("SELECT seed,expires FROM pending WHERE id=1")
      .toArray()[0];
    if (!p || p.expires < Date.now())
      throw new AuthError(400, "The QR code expired. Start setup again.");
    const seed = await this.unseal(p.seed);
    const step = validStep(seed, code);
    if (step < 0)
      throw new AuthError(401, "The authenticator code is incorrect. Check your device’s time.");
    const salt = random(16),
      hash = await passwordHash(password, salt);
    const recovery = Array.from({ length: 8 }, () => random(12));
    const session = random();
    this.ctx.storage.transactionSync(() => {
      this.requireBootstrap(token);
      this.ctx.storage.sql.exec(
        "INSERT INTO auth(id,salt,password_hash,seed,last_step) VALUES(1,?,?,?,?)",
        salt,
        hash,
        p.seed,
        step,
      );
      for (const c of recovery)
        this.ctx.storage.sql.exec("INSERT INTO recovery(hash) VALUES(?)", digest(c));
      this.ctx.storage.sql.exec("DELETE FROM pending");
      this.ctx.storage.sql.exec(
        "INSERT INTO sessions(hash,kind,expires,parent) VALUES(?,'remote',?,'')",
        digest(session),
        Date.now() + 1800000,
      );
    });
    return { session, recovery };
  }
  async login(password: string, code: string, ip: string) {
    this.reserveAttempt(ip);
    const row = this.row();
    if (!row) throw new AuthError(401, "Complete the private setup first.");
    if (password.length > 256 || code.length > 128)
      throw new AuthError(401, "Password or authentication code is incorrect.");
    const seed = await this.unseal(row.seed);
    const validPassword = equal(await passwordHash(password, row.salt), row.password_hash);
    const step = /^\d{6}$/.test(code) ? validStep(seed, code) : -1;
    const recoveryHash = digest(code.replace(/\s/g, ""));
    const token = random();
    this.ctx.storage.transactionSync(() => {
      const current = this.row()!;
      const recovery = this.ctx.storage.sql
        .exec<{ used: number }>("SELECT used FROM recovery WHERE hash=?", recoveryHash)
        .toArray()[0];
      if (
        !validPassword ||
        !((step >= 0 && step > current.last_step) || (recovery && !recovery.used))
      )
        throw new AuthError(
          401,
          "Password or authentication code is incorrect, expired, or already used.",
        );
      if (step >= 0) this.ctx.storage.sql.exec("UPDATE auth SET last_step=? WHERE id=1", step);
      else this.ctx.storage.sql.exec("UPDATE recovery SET used=1 WHERE hash=?", recoveryHash);
      this.ctx.storage.sql.exec("DELETE FROM sessions WHERE expires<?", Date.now());
      this.ctx.storage.sql.exec(
        "INSERT INTO sessions(hash,kind,expires,parent) VALUES(?,'remote',?,'')",
        digest(token),
        Date.now() + 1800000,
      );
    });
    return token;
  }
  async reserveJoin(token: string) {
    const row = this.session(token, "remote");
    if (!row) throw new AuthError(401, "Sign in again to start a browser session.");
    if (row.joins >= 5)
      throw new AuthError(
        429,
        "This login has started five sessions. Sign in again to create another.",
      );
    this.ctx.storage.sql.exec("UPDATE sessions SET joins=joins+1 WHERE hash=?", row.hash);
    return true;
  }
  async ticket(token: string, target = "dashboard") {
    const row = this.session(token, "remote");
    if (!row)
      throw new AuthError(401, "Your web login expired. Reload HK Remote to sign in again.");
    const ticket = random();
    this.ctx.storage.sql.exec("DELETE FROM tickets WHERE expires<?", Date.now());
    this.ctx.storage.sql.exec(
      "INSERT INTO tickets(hash,parent,expires,target) VALUES(?,?,?,?)",
      digest(ticket),
      row.hash,
      Date.now() + 45000,
      target,
    );
    return ticket;
  }
  async appTicket(token: string, port: number) {
    if (port !== 80 && (!Number.isInteger(port) || port < 30000 || port > 30099))
      throw new AuthError(400, "Invalid Umbrel app port.");
    const row = this.session(token, "umbrel");
    if (!row) throw new AuthError(401, "Open Umbrel again from HK Remote to renew access.");
    const ticket = random();
    this.ctx.storage.sql.exec("DELETE FROM tickets WHERE expires<?", Date.now());
    this.ctx.storage.sql.exec(
      "INSERT INTO tickets(hash,parent,expires,target) VALUES(?,?,?,?)",
      digest(ticket),
      row.parent,
      Date.now() + 45000,
      port === 80 ? "dashboard" : String(port),
    );
    return ticket;
  }
  async redeem(ticket: string, target = "dashboard") {
    const token = random();
    this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec<{ parent: string; expires: number; target: string }>(
          "SELECT parent,expires,target FROM tickets WHERE hash=?",
          digest(ticket),
        )
        .toArray()[0];
      const parent = row
        ? this.ctx.storage.sql
            .exec<{ expires: number }>("SELECT expires FROM sessions WHERE hash=?", row.parent)
            .toArray()[0]
        : undefined;
      if (
        !row ||
        row.target !== target ||
        row.expires <= Date.now() ||
        !parent ||
        parent.expires <= Date.now()
      )
        throw new AuthError(401, "This Umbrel link expired. Open it again from HK Remote.");
      this.ctx.storage.sql.exec("DELETE FROM tickets WHERE hash=?", digest(ticket));
      this.ctx.storage.sql.exec(
        "INSERT INTO sessions(hash,kind,expires,parent) VALUES(?,'umbrel',?,?)",
        digest(token),
        parent.expires,
        row.parent,
      );
    });
    return token;
  }
  async allowUmbrel(token: string) {
    return !!this.session(token, "umbrel");
  }
  async logout(token: string) {
    const hash = digest(token);
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE hash=? OR parent=?", hash, hash);
    this.ctx.storage.sql.exec("DELETE FROM tickets WHERE parent=?", hash);
    return true;
  }
}
