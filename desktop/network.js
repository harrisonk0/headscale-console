import { enableHttpsSockets } from '../src/lib/utils/https-socket.ts';
const control='https://hk-desktop.invalid';
// WebVM's networking client omits DERPPort in its browser socket URL.
// This alias intentionally maps its port-443 URL to the private relay bridge.
const relay='hk-funnel-test.tail7bbf4b.ts.net';
export async function prepareNetwork(disk,report){
  const {authKey}=await disk.rpc('join');
  // The .invalid name is a virtual endpoint, intercepted locally. Neither the
  // control request nor a relay socket leaves the browser as a WebSocket.
  window.__meshRelayProxy=relay;
  const originalFetch=window.fetch.bind(window);
  window.fetch=(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href);
    const action=url.origin===control&&url.pathname==='/key'?'key':
      url.hostname===relay&&url.pathname==='/derp/probe'?'probe':null;
    if(action)return originalFetch('/api/remote/desktop/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',signal:init?.signal});
    return originalFetch(input,init);
  };
  enableHttpsSockets(control,{apiBase:'/api/remote/desktop/socket',httpsOnly:true,report});
  let resolveReady;
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  let resolveOnline;
  const online=new Promise(resolve=>{resolveOnline=resolve;});
  return {ready,async connect(vm){
    await vm.run('/bin/true',[],{uid:0,gid:0});
    let started=false;
    for(let i=0;i<300;i++){
      try{vm.networkLogin();started=true;break;}
      catch(e){if(!e.message.includes('up is not a function'))throw e;await new Promise(r=>setTimeout(r,100));}
    }
    if(!started)throw new Error('The private network client did not initialise.');
    await Promise.race([online,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Private network did not connect through HTTPS. Try reopening the desktop.')),45000))]);
  },interface:{authKey,controlUrl:control,
    loginUrlCb:()=>report('Network approval expired. Reopen the desktop.','error'),
    stateUpdateCb:state=>{if(state===0)resolveReady();if(state===6){report('Private network connected through HTTPS','ok');resolveOnline();}},
    netmapUpdateCb:()=>{},
  }};
}
