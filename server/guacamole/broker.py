"""Loopback-only MFA bridge: issues short-lived, fixed-destination Guacamole access."""
import json,time,hmac,hashlib,base64,socket,urllib.request,urllib.parse
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from cryptography.hazmat.primitives.ciphers import Cipher,algorithms,modes
from cryptography.hazmat.primitives import padding
secrets=json.loads(Path('/etc/hk-remote-guac/secrets.json').read_text())
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  try:
   size=int(self.headers.get('Content-Length','0'))
   if not 0<size<4096:raise ValueError('Invalid request')
   b=json.loads(self.rfile.read(size));target=b.get('target')
   if target not in ('linux','mac'):raise ValueError('Unknown desktop')
   host,port=('127.0.0.1',5991) if target=='linux' else ('100.64.0.1',5900)
   with socket.create_connection((host,port),timeout=4):pass
   params={'hostname':host,'port':str(port),'color-depth':'24','cursor':'remote','clipboard-encoding':'UTF-8','enable-audio':'false'}
   if target=='linux':params['password']=secrets['vnc']
   else:params['username']='harrisonk'
   name='Linux desktop' if target=='linux' else 'This Mac'
   data=json.dumps({'username':'harrison','expires':int(time.time()*1000)+60000,'connections':{name:{'protocol':'vnc','parameters':params}}}).encode()
   key=bytes.fromhex(secrets['key']);signed=hmac.new(key,data,hashlib.sha256).digest()+data
   pad=padding.PKCS7(128).padder();signed=pad.update(signed)+pad.finalize()
   enc=Cipher(algorithms.AES(key),modes.CBC(bytes(16))).encryptor();encrypted=base64.b64encode(enc.update(signed)+enc.finalize()).decode()
   req=urllib.request.Request('http://127.0.0.1:39011/guacamole/api/tokens',data=urllib.parse.urlencode({'data':encrypted}).encode())
   token=json.load(urllib.request.urlopen(req,timeout=10))
   url='http://127.0.0.1:39011/guacamole/api/session/data/json/connections?token='+urllib.parse.quote(token['authToken'])
   connections=json.load(urllib.request.urlopen(url,timeout=10))
   result={'token':token['authToken'],'connection':next(iter(connections)),'target':target};code=200
  except (ConnectionError,TimeoutError,OSError):code=503;result={'error':'This Mac is offline or Screen Sharing is unavailable.' if locals().get('target')=='mac' else 'The Linux desktop is temporarily unavailable.'}
  except Exception:code=502;result={'error':'Could not open the desktop. Try again.'}
  output=json.dumps(result).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(output)));self.end_headers();self.wfile.write(output)
ThreadingHTTPServer(('127.0.0.1',39012),Handler).serve_forever()
