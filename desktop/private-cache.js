import {DEVICE,DATABASE} from './disk-store.js';
let device,release;
const lockName=name=>'hk-desktop-cache:'+name;
function remove(name){return new Promise(resolve=>{const req=indexedDB.deleteDatabase(name);req.onsuccess=()=>resolve();req.onerror=()=>resolve();setTimeout(resolve,1500);});}
export async function preparePrivateCache(){
  if(!navigator.locks)return;
  await new Promise((resolve,reject)=>{
    navigator.locks.request(lockName(DATABASE),()=>{resolve();return new Promise(done=>{release=done;});}).catch(reject);
  });
  // Each running page owns a separate DB and lock. Only abandoned desktop
  // caches are removed; another tab's live environment is left alone.
  for(const db of await indexedDB.databases()){
    if(db.name!==DATABASE && db.name?.startsWith('cjFS_/hk-desktop-icewm-'))
      await navigator.locks.request(lockName(db.name),{ifAvailable:true},async lock=>{if(lock)await remove(db.name);});
  }
}
export function registerPrivateCache(value){device=value;}
export async function clearPrivateCache(){
  // Use the supported engine API so worker-owned DB connections are cleared
  // too. This runs after the guest stops and its remote save is acknowledged.
  if(device)await device.reset();
  release?.();release=undefined;
  await remove(DATABASE);
}
addEventListener('pagehide',()=>{void device?.reset().catch(()=>{});release?.();void remove(DATABASE);});
