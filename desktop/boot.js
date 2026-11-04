export const environment=[
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'DISPLAY=:0','HOME=/home/user','USER=user','LOGNAME=user','SHELL=/bin/bash',
  'XDG_RUNTIME_DIR=/tmp/hk-runtime-user','XDG_SESSION_TYPE=x11','XDG_CURRENT_DESKTOP=IceWM',
  'LIBGL_ALWAYS_SOFTWARE=1',
];
export async function bootDesktop(vm,report){
  report('Preparing your IceWM desktop…');
  const cleanup="import os\nfor p in ['/tmp/.X0-lock','/tmp/.X11-unix/X0','/run/dbus/system_bus_socket','/run/dbus/pid']:\n try: os.unlink(p)\n except FileNotFoundError: pass\n";
  let r=await vm.run('/usr/bin/python3',['-c',cleanup],{uid:0,gid:0,env:environment});
  if(r.status!==0)throw new Error('Could not prepare the desktop runtime.');
  r=await vm.run('/bin/sh',['-c','mkdir -p /run/dbus /tmp/.X11-unix /tmp/hk-runtime-user; chmod 1777 /tmp /tmp/.X11-unix; chmod 700 /tmp/hk-runtime-user; chown 1000:1000 /tmp/hk-runtime-user; /sbin/udevd --daemon'],{uid:0,gid:0,env:environment});
  if(r.status!==0)throw new Error('The desktop support services did not start.');
  let xError;
  void vm.run('/usr/libexec/Xorg',[':0','-ac','-noreset','-nolisten','tcp','vt7'],{uid:0,gid:0,env:environment}).then(r=>{xError=new Error('The graphics server stopped (code '+r.status+').');}).catch(e=>{xError=e;});
  report('Starting the display…');
  let ready=false;
  for(let i=0;i<240;i++){
    if(xError)throw xError;
    const r=await vm.run('/bin/sh',['-c','test -S /tmp/.X11-unix/X0'],{uid:0,gid:0,env:environment});
    if(r.status===0){ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready)throw new Error('The desktop display took too long to start.');
  report('Starting IceWM…');
  let ended;
  const session=vm.run('/usr/bin/icewm-session',[],{uid:1000,gid:1000,cwd:'/home/user',env:environment}).then(r=>{ended=r;return r;});
  // Query the running X server and IceWM's EWMH ownership property. A socket
  // file and a live process alone do not mean that the desktop has started.
  report('Waiting for the desktop window manager to respond…');
  const probe=String.raw`import ctypes as c,time,sys
x=c.CDLL('libX11.so.6')
x.XOpenDisplay.argtypes=[c.c_char_p];x.XOpenDisplay.restype=c.c_void_p
x.XDefaultRootWindow.argtypes=[c.c_void_p];x.XDefaultRootWindow.restype=c.c_ulong
x.XInternAtom.argtypes=[c.c_void_p,c.c_char_p,c.c_int];x.XInternAtom.restype=c.c_ulong
x.XGetWindowProperty.argtypes=[c.c_void_p,c.c_ulong,c.c_ulong,c.c_long,c.c_long,c.c_int,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_int),c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.c_void_p)]
x.XFree.argtypes=[c.c_void_p]
x.XCloseDisplay.argtypes=[c.c_void_p]
for attempt in range(120):
 d=x.XOpenDisplay(b':0')
 if d:
  atom=x.XInternAtom(d,b'_NET_SUPPORTING_WM_CHECK',1)
  typ=c.c_ulong();fmt=c.c_int();n=c.c_ulong();remaining=c.c_ulong();value=c.c_void_p()
  ok=atom and x.XGetWindowProperty(d,x.XDefaultRootWindow(d),atom,0,1,0,0,c.byref(typ),c.byref(fmt),c.byref(n),c.byref(remaining),c.byref(value))==0 and fmt.value==32 and n.value==1
  if value:x.XFree(value)
  x.XCloseDisplay(d)
  if ok:sys.exit(0)
 time.sleep(1)
sys.exit(1)
`;
  let timer;
  try{
    const result=await Promise.race([
      vm.run('/usr/bin/python3',['-c',probe],{uid:1000,gid:1000,cwd:'/home/user',env:environment}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The graphics system did not respond within three minutes. Open the startup details below.')),180000);}),
    ]);
    if(xError)throw xError;
    if(ended)throw new Error('IceWM stopped before it was ready (code '+ended.status+').');
    if(result.status!==0)throw new Error('The desktop window manager did not become ready. Open the startup details below.');
  }finally{clearTimeout(timer);}
  return {session};
}
