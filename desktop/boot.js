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
  // CheerpX does not reliably support pidof; detect early session failure
  // without running that guest utility. The X11 display was checked above.
  await new Promise(resolve=>setTimeout(resolve,5000));
  if(xError)throw xError;
  if(ended)throw new Error('IceWM stopped before it was ready (code '+ended.status+').');
  return {session};
}
