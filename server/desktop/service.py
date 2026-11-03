"""Loopback-only service; public access MUST go through the MFA Worker bridge."""
import base64
import json
import os
import re
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from storage import Store, Conflict

PATH = os.environ.get('HK_DESKTOP_DB', '/var/lib/hk-desktop/disk.sqlite')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never log headers, guest data or session handles.

    def reply(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        self.connection.settimeout(20)
        store = None
        try:
            session = self.headers.get('X-Desktop-Session', '')
            expires = int(self.headers.get('X-Desktop-Expires', '0'))
            if not re.fullmatch('[a-f0-9]{64}', session) or expires <= time.time()*1000:
                return self.reply(401, {'error':'Sign in again to save your desktop.'})
            length = int(self.headers.get('Content-Length', '-1'))
            if length < 0 or length > 8*1024*1024:
                return self.reply(413, {'error':'Save request too large.'})
            b = json.loads(self.rfile.read(length))
            if not isinstance(b, dict):
                raise ValueError('Expected an object')
            store = Store(PATH)
            lease = b.get('lease', '')
            if not isinstance(lease, str):
                raise ValueError('Invalid lease')
            if self.path == '/claim':
                result = store.claim(session, b.get('takeover') is True)
            elif self.path == '/join':
                store.check(session, lease)
                key = json.loads(subprocess.run(
                    ['/usr/bin/headscale', '-c', '/etc/headscale-desktop/config.yaml',
                     'preauthkeys', 'create', '--user', '1', '--ephemeral',
                     '--expiration', '2m', '--output', 'json'],
                    check=True, capture_output=True, text=True, timeout=15).stdout)
                result = {'authKey': key['key']}
            elif self.path == '/heartbeat':
                result = store.heartbeat(session, lease)
            elif self.path == '/resume':
                result = store.resume(session, lease)
                result['authExpires'] = expires
            elif self.path == '/release':
                result = store.release(session, lease)
            elif self.path == '/put':
                result = store.put(session, lease, b['hash'], base64.b64decode(b['data'], validate=True))
            elif self.path == '/begin':
                result = store.begin(session, lease)
            elif self.path == '/read':
                result = {'data':base64.b64encode(store.read(session, lease, b['hash'])).decode()}
            elif self.path == '/commit':
                result = store.commit(session, lease, b['revision'], b['manifest'])
            else:
                return self.reply(404, {'error':'Not found'})
            self.reply(200, result)
        except Conflict as e:
            self.reply(409, {'error':str(e)})
        except (ValueError, KeyError, TypeError):
            self.reply(400, {'error':'Invalid or incomplete disk save.'})
        except Exception:
            self.reply(503, {'error':'Desktop storage unavailable. Your previous save is unchanged.'})
        finally:
            if store:
                store.db.close()


if __name__ == '__main__':
    os.umask(0o077)
    HTTPServer(('127.0.0.1', int(os.environ.get('HK_DESKTOP_PORT', '39009'))), Handler).serve_forever()
