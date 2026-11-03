import {RemoteDisk,ENGINE,BASE,DEVICE} from './disk-store.js';
import {prepareNetwork} from './network.js';
import {preparePrivateCache,registerPrivateCache,clearPrivateCache} from './private-cache.js';
import {bootDesktop} from './boot.js';
const $=id=>document.getElementById(id);
let vm=null,disk=null,busy=false,stopped=false,generation=0,savedGeneration=-1,needsAuth=false;
let heartbeatTimer,saveTimer,lastHeartbeat=0;
const status=text=>{$('status').textContent=text;};
async function post(action,data={}){
 const r=await fetch('/api/remote/desktop/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000)});
 const b=await r.json();if(!r.ok){const e=new Error(b.error||'Desktop storage is unavailable.');e.status=r.status;throw e;}return b;
}
function stop(message){stopped=true;clearInterval(heartbeatTimer);clearInterval(saveTimer);vm?.delete();vm=null;$('display').hidden=true;$('start').hidden=false;$('message').textContent=message;status(message);$('save').disabled=true;$('exit').disabled=true;}
async function heartbeat(){
 try{const result=await disk.rpc('resume');lastHeartbeat=Date.now();
  if(needsAuth){needsAuth=false;$('save').disabled=busy;$('exit').disabled=busy;status('Sign-in renewed — saving can continue.');}
  $('reauth').hidden=result.authExpires-Date.now()>120000;
 }
 catch(e){if(e.status===409)stop(e.message);else if(e.status===401){needsAuth=true;$('save').disabled=true;$('exit').disabled=true;$('reauth').hidden=false;status('Sign in again to resume saving. Changes remain on this computer.');}else{status('Connection lost — changes are not saved remotely.');}}
}
async function save(exit=false){
 if(busy||!vm||stopped||needsAuth)return;
 busy=true;$('save').disabled=true;$('exit').disabled=true;status('Saving to your private storage…');
 try{
  let checkpointGeneration;
  await disk.save(vm,()=>{checkpointGeneration=generation;});
  savedGeneration=checkpointGeneration;
  status('Saved at '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}));
  if(exit){await disk.rpc('release');stopped=true;vm.delete();vm=null;status('Saved — clearing this computer’s personal cache…');await clearPrivateCache();location.assign('/');}
 }catch(e){status(e.message);if(e.status===409)stop(e.message);if(e.status===401){needsAuth=true;$('save').disabled=true;$('exit').disabled=true;$('reauth').hidden=false;}}
 finally{busy=false;if(!stopped){$('save').disabled=false;$('exit').disabled=false;}}
}
async function start(takeover=false){
 if(busy)return;busy=true;$('launch').disabled=true;$('takeover').disabled=true;
 try{
  disk=new RemoteDisk(post);status('Opening your saved desktop…');
  const manifest=await disk.claim(takeover);lastHeartbeat=Date.now();
  heartbeatTimer=setInterval(heartbeat,15000);
  await preparePrivateCache();
  await disk.restore(manifest,(done,total)=>status(`Restoring your desktop (${done}/${total} disk records)…`));status('Loading the desktop engine…');
  if(!crossOriginIsolated)throw new Error('This browser did not enable the isolation required by WebVM.');
  const cx=await import(/* @vite-ignore */ `https://cxrtnc.leaningtech.com/${ENGINE}/cx.esm.js`);
  // An HTTPS disk source avoids the WebSocket backend entirely.
  const base=await cx.HttpBytesDevice.create('/api/remote/desktop/base?v='+BASE);
  const cache=await cx.IDBDevice.create(DEVICE);
  registerPrivateCache(cache);
  const overlay=await cx.OverlayDevice.create(base,cache);
  status('Preparing your private network through HTTPS…');
  const network=await prepareNetwork(disk,(message)=>status(message));
  vm=await cx.Linux.create({networkInterface:network.interface,mounts:[{type:'ext2',path:'/',dev:overlay},{type:'devs',path:'/dev'},{type:'devpts',path:'/dev/pts'},{type:'proc',path:'/proc'},{type:'sys',path:'/sys'}]});
  vm.registerCallback('diskActivity',state=>{if(state!=='ready'){generation++;if(!busy)status('Changes waiting to save…');}});
  const consoleOutput=$('console');
  const read=vm.setCustomConsole((buf,vt)=>{if(vt===1){consoleOutput.textContent=(consoleOutput.textContent+new TextDecoder().decode(new Uint8Array(buf))).slice(-16000);}},120,40);
  $('display').addEventListener('keydown',e=>{if(e.ctrlKey&&e.altKey&&e.key==='1'){consoleOutput.hidden=!consoleOutput.hidden;e.preventDefault();}});
  consoleOutput.addEventListener('keydown',e=>{if(e.key==='Enter')read(13);else if(e.key.length===1)read(e.key.charCodeAt(0));});
  vm.setKmsCanvas($('display'),Math.max(1024,innerWidth),Math.max(768,innerHeight-140));
  vm.setActivateConsole(vt=>{if(vt===7){$('display').hidden=false;consoleOutput.hidden=true;}});
  await network.connect(vm);
  await vm.run('/bin/sh',['-c',"printf 'nameserver 100.96.0.1\\nsearch mesh.movenis.dev\\n' > /etc/resolv.conf"],{uid:0,gid:0});
  $('start').hidden=true;$('display').hidden=false;$('display').focus();
  $('detail').textContent='HTTPS autosave · Private network via hk-cloud · One active computer';
  const desktop=await bootDesktop(vm,status);
  status('IceWM started — autosave checks every 15 seconds.');
  void desktop.session.then(()=>{if(!stopped)void save(true);}).catch(e=>{if(!stopped)stop(e.message);});
  saveTimer=setInterval(()=>{if(!busy&&!needsAuth)void save();},15000);
  $('save').disabled=false;$('exit').disabled=false;
 }catch(e){status(e.message);$('message').textContent=e.message;if(e.status===409)$('takeover').hidden=false;else{clearInterval(heartbeatTimer);if(disk?.lease)await disk.rpc('release').catch(()=>{});}}
 finally{busy=false;$('launch').disabled=false;$('takeover').disabled=false;}
}
$('launch').onclick=()=>start();$('takeover').onclick=()=>start(true);$('save').onclick=()=>save();$('exit').onclick=()=>save(true);
addEventListener('beforeunload',e=>{if(vm&&!stopped){e.preventDefault();e.returnValue='';}});
(async()=>{try{const r=await fetch('/api/remote/status',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw new Error('Login service unavailable.');const s=await r.json();if(!s.authenticated){$('login').hidden=false;status('Sign in to continue');$('message').textContent='Your password and one-time code protect this desktop.';return;}$('message').textContent='Ready to restore your files, apps and settings. Your private network connects through hk-cloud using HTTPS.';$('launch').hidden=false;status('Ready');}catch(e){status(e.message);}})();
