import Guacamole from './guacamole-client.js';
const $=id=>document.getElementById(id);
const target=new URLSearchParams(location.search).get('target')==='mac'?'mac':'linux';
$('title').textContent=target==='mac'?'This Mac':'Linux desktop';
let client,keyboard,connecting=false,connected=false,screenTimer;
const show=(text,error=false)=>{$('status').textContent=text;$('message').textContent=text;$('notice').hidden=false;$('notice').querySelector('.loader').hidden=error;$('reconnect').hidden=!error;};
function fit(){if(!client)return;const d=client.getDisplay();if(d.getWidth()&&d.getHeight())d.scale(Math.min(1,$('workspace').clientWidth/d.getWidth(),$('workspace').clientHeight/d.getHeight()));}
async function connect(){
 if(connecting)return;connecting=true;connected=false;client?.disconnect();keyboard?.reset();clearTimeout(screenTimer);show('1/3 Checking your sign-in and desktop availability…');$('reconnect').hidden=true;
 try{
  const response=await fetch('/api/remote/guac/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target}),credentials:'same-origin',signal:AbortSignal.timeout(25000)});
  let data;try{data=await response.json();}catch{throw Error('The sign-in endpoint returned an unexpected page. This request may be filtered by the network.');}if(!response.ok){if(response.status===401)$('login').hidden=false;throw Error(data.error||'Could not connect.');}
  const G=Guacamole;show('2/3 Opening the HTTPS desktop tunnel…');
  // Deliberately use the official HTTP tunnel only. No WebSocket or WebVM.
  const tunnel=new G.HTTPTunnel('/api/remote/guac/proxy/tunnel');client=new G.Client(tunnel);
  const display=client.getDisplay();$('display').replaceChildren(display.getElement());display.onresize=fit;
  client.onstatechange=state=>{if(state===2){show('3/3 Waiting for the remote screen…');}else if(state===3){clearTimeout(screenTimer);connected=true;$('notice').hidden=true;$('status').textContent='Connected · Your files stay on this computer';fit();$('workspace').focus();}else if(state===5){connected=false;show('Disconnected. Your desktop stays running. Reconnect whenever you’re ready.',true);}};
  client.onerror=error=>{clearTimeout(screenTimer);connected=false;show(error.message||'The connection ended. Try reconnecting.',true);};
  client.onrequired=parameters=>{
   clearTimeout(screenTimer);$('credentials').showModal();$('credential-form').onsubmit=event=>{event.preventDefault();for(const name of parameters){if(!['username','password'].includes(name))continue;const writer=new G.StringWriter(client.createArgumentValueStream('text/plain',name));writer.sendText($(name).value);writer.sendEnd();}$('password').value='';$('credentials').close();};
  };
  const mouse=new G.Mouse(display.getElement());mouse.onmousedown=mouse.onmouseup=mouse.onmousemove=state=>{if(connected){if(state.left||state.middle||state.right)$('workspace').focus();client.sendMouseState(state,true);}};
  keyboard=new G.Keyboard($('workspace'));keyboard.onkeydown=key=>{if(connected){client.sendKeyEvent(1,key);return false;}};keyboard.onkeyup=key=>{if(connected)client.sendKeyEvent(0,key);};
  const parameters=new URLSearchParams({token:data.token,GUAC_DATA_SOURCE:'json',GUAC_ID:data.connection,GUAC_TYPE:'c',GUAC_WIDTH:String(Math.min(1920,innerWidth)),GUAC_HEIGHT:String(Math.max(600,innerHeight-90)),GUAC_DPI:'96',GUAC_TIMEZONE:Intl.DateTimeFormat().resolvedOptions().timeZone});
  parameters.append('GUAC_IMAGE','image/png');parameters.append('GUAC_IMAGE','image/jpeg');
  client.connect(parameters.toString());
  screenTimer=setTimeout(()=>{if(!connected){client.disconnect();show('The HTTPS desktop tunnel did not deliver a screen within 30 seconds. The network or an HTTP proxy may be interrupting it.',true);}},30000);
 }catch(error){clearTimeout(screenTimer);show(error.name==='TimeoutError'?'The sign-in/desktop availability request timed out before a tunnel could be opened.':error.message||'Connection failed. Please try again.',true);}finally{connecting=false;}
}
$('reconnect').onclick=connect;$('disconnect').onclick=()=>{client?.disconnect();location.assign('/');};$('cancel').onclick=()=>{$('password').value='';$('credentials').close();client?.disconnect();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{show('Fullscreen is unavailable in this browser.',true);}};
addEventListener('resize',fit);addEventListener('blur',()=>keyboard?.reset());addEventListener('pagehide',()=>client?.disconnect());
void connect();
