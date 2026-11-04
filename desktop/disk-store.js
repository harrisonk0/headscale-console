// CheerpX 1.4.0 adapter. Fail closed on schema changes; never interpret a
// different engine's overlay as this disk. The vendor engine stays on its CDN.
export const ENGINE = '1.4.0';
export const BASE = 'hk-icewm-v1-f6a296075b6f.ext2';
export const DEVICE = 'hk-desktop-icewm-f6a296075b6f-'+crypto.randomUUID();
export const DATABASE = `cjFS_/${DEVICE}/`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const base64 = bytes => {
  let s = '';
  for (let i=0;i<bytes.length;i+=32768) s+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(s);
};
export const unbase64 = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
function pack(v) {
  if (v instanceof Uint8Array) return ['bytes',base64(v)];
  if (v instanceof ArrayBuffer) return ['buffer',base64(new Uint8Array(v))];
  if (v instanceof Date) return ['date',v.toISOString()];
  if (Array.isArray(v)) return ['array',v.map(pack)];
  if (v && Object.getPrototypeOf(v)===Object.prototype) return ['object',Object.entries(v).map(([k,x])=>[k,pack(x)])];
  if (v===null || ['string','number','boolean'].includes(typeof v)) return ['scalar',v];
  throw new Error('Unsupported disk record. Previous remote save is unchanged.');
}
function unpack([tag,v]) {
  if(tag==='bytes') return unbase64(v);
  if(tag==='buffer') return unbase64(v).buffer;
  if(tag==='date') return new Date(v);
  if(tag==='array') return v.map(unpack);
  if(tag==='object') return Object.fromEntries(v.map(([k,x])=>[k,unpack(x)]));
  if(tag==='scalar') return v;
  throw new Error('Unknown disk record encoding');
}
function openDatabase(create=false) {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DATABASE,1);
    r.onupgradeneeded=()=>{if(create)r.result.createObjectStore('files');else r.transaction.abort();};
    r.onerror=()=>reject(new Error('Desktop disk is not ready.'));
    r.onblocked=()=>reject(new Error('Close other desktop tabs before restoring.'));
    r.onsuccess=()=>{
      const db=r.result;
      if(db.objectStoreNames.length!==1 || !db.objectStoreNames.contains('files')){db.close();reject(new Error('Unknown disk schema'));return;}
      db.onversionchange=()=>db.close(); resolve(db);
    };
  });
}
export async function capture(marker) {
  const db=await openDatabase();
  const records=await new Promise((resolve,reject)=>{
    const tx=db.transaction('files','readonly'), store=tx.objectStore('files');
    const keys=store.getAllKeys(), values=store.getAll();
    tx.oncomplete=()=>resolve(keys.result.map((k,i)=>[k,values.result[i]]));
    tx.onabort=()=>reject(tx.error);
  }).finally(()=>db.close());
  if(marker && !records.some(([,v])=>v.contents instanceof Uint8Array && decoder.decode(v.contents).includes(marker)))
    throw new Error('CHECKPOINT_PENDING');
  const chunks=new Map();
  for(const record of records){
    const bytes=encoder.encode(JSON.stringify(pack(record)));
    if(bytes.length>2*1024*1024) throw new Error('Disk record is too large to sync.');
    chunks.set(await hash(bytes),bytes);
  }
  return {manifest:{format:'hk-desktop-idb-v1',engine:ENGINE,base:BASE,chunks:[...chunks.keys()]},chunks};
}
export async function restore(manifest,read) {
  if(!manifest)return;
  if(manifest.format!=='hk-desktop-idb-v1'||manifest.engine!==ENGINE||manifest.base!==BASE)
    throw new Error('Saved disk needs a different desktop version. Refusing to reset it.');
  // Verify every record before replacing local data. Remote state stays immutable.
  const records=[];
  for(const key of manifest.chunks){
    const bytes=await read(key);
    if(await hash(bytes)!==key)throw new Error('Saved disk failed its integrity check.');
    records.push(unpack(JSON.parse(decoder.decode(bytes))));
  }
  const db=await openDatabase(true);
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('files','readwrite'),store=tx.objectStore('files');
    store.clear();for(const [key,value] of records)store.put(value,key);
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  }).finally(()=>db.close());
}
export class RemoteDisk {
  constructor(post){this.post=post;this.lease='';this.revision=0;this.known=new Set();}
  async claim(takeover=false){
    const s=await this.post('claim',{takeover});
    this.lease=s.lease;this.revision=s.revision;
    this.known=new Set(s.manifest?.chunks||[]);
    return s.manifest;
  }
  rpc(action,data={}){return this.post(action,{...data,lease:this.lease});}
  async restore(manifest,progress=()=>{}){let done=0;await restore(manifest,async hash=>{const bytes=unbase64((await this.rpc('read',{hash})).data);progress(++done,manifest.chunks.length);return bytes;});}
  async save(vm,onSnapshot=()=>{},progress=()=>{}){
    const marker=crypto.randomUUID();
    const flushed=await vm.run('/bin/sh',['-c',`mkdir -p /var/lib/hk-remote; sync; printf '%s' '${marker}' > /var/lib/hk-remote/checkpoint; sync`],{uid:0,gid:0});
    if(flushed.status!==0)throw new Error('Linux could not flush the desktop disk.');
    let snapshot;
    for(let attempt=0;attempt<100;attempt++){
      try{snapshot=await capture(marker);break;}catch(e){if(e.message!=='CHECKPOINT_PENDING')throw e;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!snapshot)throw new Error('Desktop is still flushing to browser storage. Save again before leaving.');
    const {manifest,chunks}=snapshot;
    onSnapshot();
    // Recover an acknowledged-on-server but interrupted-on-client save, and
    // discard abandoned uploads without touching the three completed versions.
    progress('Checking the last saved version…');
    const head=await this.rpc('begin');
    this.revision=head.revision;this.known=new Set(head.manifest?.chunks||[]);
    const previous=[...this.known];
    if(previous.length===manifest.chunks.length&&previous.every((v,i)=>v===manifest.chunks[i])) return;
    const uploads=[...chunks].filter(([hash])=>!this.known.has(hash));
    for(let i=0;i<uploads.length;i++){
      const [hash,bytes]=uploads[i];
      progress(`Saving changes (${i+1}/${uploads.length} disk records)…`);
      await this.rpc('put',{hash,data:base64(bytes)});
    }
    progress('Confirming your save…');
    const result=await this.rpc('commit',{revision:this.revision,manifest});
    this.revision=result.revision;this.known=new Set(manifest.chunks);
  }
}
