// Real CheerpX + real HTTP storage. Synthetic authentication exists only in this
// loopback fixture; it does not mint any Tailscale devices or use production auth.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hk-desktop-test-'));
const child=spawn('python3',[path.join(repo,'server/desktop/service.py')],{env:{...process.env,HK_DESKTOP_DB:path.join(tmp,'disk.sqlite'),HK_DESKTOP_PORT:'39110'},stdio:'ignore'});
for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:39110/claim',{method:'POST',body:'{}'});break;}catch{await new Promise(r=>setTimeout(r,50));}}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/base.ext2' && process.env.HK_DESKTOP_IMAGE){
   const filename=process.env.HK_DESKTOP_IMAGE,size=fs.statSync(filename).size;
   const h={'Content-Type':'application/octet-stream','Accept-Ranges':'bytes','Last-Modified':new Date(1700000000000).toUTCString()};
   if(req.method==='HEAD'){res.writeHead(200,{...h,'Content-Length':size});res.end();return;}
   const m=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);if(!m){res.writeHead(416);res.end();return;}
   const start=Number(m[1]),end=m[2]?Number(m[2]):size-1;
   res.writeHead(206,{...h,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${size}`});fs.createReadStream(filename,{start,end}).pipe(res);return;
  }
  if(req.url.startsWith('/api/remote/desktop/')){
   let body='';for await(const c of req)body+=c;
   const r=await fetch('http://127.0.0.1:39110/'+req.url.split('/').at(-1),{method:'POST',headers:{'Content-Type':'application/json','X-Desktop-Session':'a'.repeat(64),'X-Desktop-Expires':String(Date.now()+3600000)},body});
   res.writeHead(r.status,{'Content-Type':'application/json'});res.end(await r.text());return;
  }
  res.writeHead(200,{'Content-Type':req.url==='/disk-store.js'?'text/javascript':'text/html','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});
  res.end(req.url==='/disk-store.js'?fs.readFileSync(path.join(repo,'desktop/disk-store.js')):'<title>Roaming disk test</title>');
 }catch(e){res.writeHead(500);res.end(e.message);}
}).listen(18769,'127.0.0.1');
const browser=await chromium.launch();let nativeSockets=0;
async function fresh(){const context=await browser.newContext();const p=await context.newPage();p.on('websocket',()=>nativeSockets++);await p.goto('http://127.0.0.1:18769/');await p.evaluate(v=>window.useLocalImage=v,Boolean(process.env.HK_DESKTOP_IMAGE));return p;}
async function boot(p){return p.evaluate(async()=>{
 const cx=await import('https://cxrtnc.leaningtech.com/1.4.0/cx.esm.js');window.mod=await import('/disk-store.js');
 const base=await (window.useLocalImage?cx.HttpBytesDevice.create('/base.ext2'):cx.CloudDevice.create('https://disks.webvm.io/alpine_20251007.ext2'));
 const cache=await cx.IDBDevice.create(mod.DEVICE),overlay=await cx.OverlayDevice.create(base,cache);
 window.vm=await cx.Linux.create({mounts:[{type:'ext2',path:'/',dev:overlay},{type:'devs',path:'/dev'},{type:'proc',path:'/proc'}]});
 });}
async function connectDisk(p,takeover=false){return p.evaluate(async takeover=>{
 window.mod=await import('/disk-store.js');
 window.disk=new mod.RemoteDisk(async(action,data)=>{const r=await fetch('/api/remote/desktop/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const b=await r.json();if(!r.ok)throw Object.assign(new Error(b.error),{status:r.status});return b;});
 const manifest=await disk.claim(takeover);await disk.restore(manifest);return disk.revision;
 },takeover);}
try{
 const a=await fresh();await connectDisk(a);await boot(a);
 const written=await a.evaluate(()=>vm.run('/bin/sh',['-c','mkdir -p /root/.config; echo roaming-proof > /root/hk-file; echo custom-setting > /root/.config/hk-setting; printf "#!/bin/sh\\necho tool-installed\\n" > /usr/local/bin/hk-tool; chmod 755 /usr/local/bin/hk-tool'],{uid:0,gid:0}));
 assert.equal(written.status,0);
 // No artificial delay: save must wait for the guest checkpoint to reach IDB.
 await a.evaluate(()=>disk.save(vm));
 const b=await fresh();assert.equal(await connectDisk(b,true),1);await boot(b);
 const restored=await b.evaluate(()=>vm.run('/bin/sh',['-c','test "$(cat /root/hk-file)" = roaming-proof && test "$(cat /root/.config/hk-setting)" = custom-setting && test "$(/usr/local/bin/hk-tool)" = tool-installed'],{uid:0,gid:0}));
 assert.equal(restored.status,0);
 await assert.rejects(a.evaluate(()=>disk.rpc('heartbeat')),/ended or moved/);
 assert.equal(nativeSockets,0);
 console.log('PASS: file, settings and executable restored through HTTP in a fresh browser. Old writer fenced. No browser WebSockets.');
}finally{
 await browser.close();server.close();child.kill();
 for(const name of ['disk.sqlite','disk.sqlite-shm','disk.sqlite-wal']){try{fs.unlinkSync(path.join(tmp,name))}catch{}}
 try{fs.rmdirSync(tmp)}catch{}
}
