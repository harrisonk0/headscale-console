const $=id=>document.getElementById(id);
const target=new URLSearchParams(location.search).get('target')==='mac'?'mac':'linux';
$('title').textContent=target==='mac'?'This Mac':'Linux desktop';
let client,keyboard,connecting=false,connected=false;
const show=(text,error=false)=>{$('status').textContent=text;$('message').textContent=text;$('notice').hidden=false;$('notice').querySelector('.loader').hidden=error;$('reconnect').hidden=!error;};
function fit(){if(!client)return;const d=client.getDisplay();if(d.getWidth()&&d.getHeight())d.scale(Math.min(1,$('workspace').clientWidth/d.getWidth(),$('workspace').clientHeight/d.getHeight()));}
async function loadLibrary(){if(window.Guacamole)return;await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vendor/remote-client-1.6.js';script.onload=resolve;script.onerror=()=>reject(Error('The desktop client download failed. Refresh this page to retry.'));document.head.append(script);});}
async function connect(){
 if(connecting)return;connecting=true;connected=false;client?.disconnect();keyboard?.reset();show('Opening your '+(target==='mac'?'Mac':'Linux desktop')+'…');$('reconnect').hidden=true;
 try{
  const response=await fetch('/api/remote/guac/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target}),credentials:'same-origin',signal:AbortSignal.timeout(25000)});
  const data=await response.json();if(!response.ok){if(response.status===401)$('login').hidden=false;throw Error(data.error||'Could not connect.');}
  await loadLibrary();const G=window.Guacamole;
  // Deliberately use the official HTTP tunnel only. No WebSocket or WebVM.
  const tunnel=new G.HTTPTunnel('/api/remote/guac/proxy/tunnel');client=new G.Client(tunnel);
  const display=client.getDisplay();$('display').replaceChildren(display.getElement());display.onresize=fit;
  client.onstatechange=state=>{if(state===3){connected=true;$('notice').hidden=true;$('status').textContent='Connected · Your files stay on this computer';fit();$('workspace').focus();}else if(state===5){connected=false;show('Disconnected. Your desktop stays running. Reconnect whenever you’re ready.',true);}};
  client.onerror=error=>{connected=false;show(error.message||'The connection ended. Try reconnecting.',true);};
  client.onrequired=parameters=>{
   $('credentials').showModal();$('credential-form').onsubmit=event=>{event.preventDefault();for(const name of parameters){if(!['username','password'].includes(name))continue;const writer=new G.StringWriter(client.createArgumentValueStream('text/plain',name));writer.sendText($(name).value);writer.sendEnd();}$('password').value='';$('credentials').close();};
  };
  const mouse=new G.Mouse(display.getElement());mouse.onmousedown=mouse.onmouseup=mouse.onmousemove=state=>{if(connected)client.sendMouseState(state,true);};
  keyboard=new G.Keyboard($('workspace'));keyboard.onkeydown=key=>{if(connected){client.sendKeyEvent(1,key);return false;}};keyboard.onkeyup=key=>{if(connected)client.sendKeyEvent(0,key);};
  const parameters=new URLSearchParams({token:data.token,GUAC_DATA_SOURCE:'json',GUAC_ID:data.connection,GUAC_TYPE:'c',GUAC_WIDTH:String(Math.min(1920,innerWidth)),GUAC_HEIGHT:String(Math.max(600,innerHeight-90)),GUAC_DPI:'96',GUAC_TIMEZONE:Intl.DateTimeFormat().resolvedOptions().timeZone});
  parameters.append('GUAC_IMAGE','image/png');parameters.append('GUAC_IMAGE','image/jpeg');
  client.connect(parameters.toString());
 }catch(error){show(error.message||'Connection failed. Please try again.',true);}finally{connecting=false;}
}
$('reconnect').onclick=connect;$('disconnect').onclick=()=>{client?.disconnect();location.assign('/');};$('cancel').onclick=()=>{$('password').value='';$('credentials').close();client?.disconnect();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{show('Fullscreen is unavailable in this browser.',true);}};
addEventListener('resize',fit);addEventListener('blur',()=>keyboard?.reset());addEventListener('pagehide',()=>client?.disconnect());
void connect();
