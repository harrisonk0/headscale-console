import os,pathlib,subprocess,secrets,json,pwd
P=pathlib.Path('/etc/hk-remote-guac');P.mkdir(mode=0o700,exist_ok=True)
def run(*args,**kw):return subprocess.run(args,check=True,**kw)
try:pwd.getpwnam('hk-desktop')
except KeyError:run('useradd','-m','-s','/bin/bash','hk-desktop')
u=pwd.getpwnam('hk-desktop')
config=pathlib.Path(u.pw_dir)/'.config/lxqt';config.mkdir(parents=True,exist_ok=True)
(config/'session.conf').write_text('[General]\nwindow_manager=openbox\nleave_confirmation=false\n')
run('chown','-R','hk-desktop:hk-desktop',str(config.parent))
secret=P/'secrets.json'
if not secret.exists():secret.write_text(json.dumps({'key':secrets.token_hex(16),'vnc':secrets.token_urlsafe(6)}));secret.chmod(0o600)
s=json.loads(secret.read_text())
vncp=P/'vncpasswd';vncp.write_bytes(subprocess.check_output(['tigervncpasswd','-f'],input=s['vnc'].encode()+b'\n'));vncp.chmod(0o600);os.chown(vncp,u.pw_uid,u.pw_gid)
# Only this persistent desktop account runs in the graphical session.
unit='''[Unit]
Description=HK Remote persistent LXQt desktop
After=network.target
[Service]
User=hk-desktop
Group=hk-desktop
RuntimeDirectory=hk-lxqt
Environment=HOME=/home/hk-desktop
Environment=DISPLAY=:91
Environment=XDG_RUNTIME_DIR=/run/hk-lxqt
Environment=QT_X11_NO_MITSHM=1
ExecStart=/usr/bin/Xtigervnc :91 -localhost yes -rfbport 5991 -rfbauth /etc/hk-remote-guac/vncpasswd -geometry 1440x900 -depth 24 -AlwaysShared -NeverShared=0 -Disconnect=0 -nolisten tcp
Restart=on-failure
[Install]
WantedBy=multi-user.target
'''
# VNC credential file is readable via a narrow group traversal permission.
P.chmod(0o710);os.chown(P,0,u.pw_gid)
pathlib.Path('/etc/systemd/system/hk-lxqt-display.service').write_text(unit.replace(' -Disconnect=0',''))
pathlib.Path('/etc/systemd/system/hk-lxqt-session.service').write_text('''[Unit]
Description=HK Remote LXQt session
Requires=hk-lxqt-display.service
After=hk-lxqt-display.service
[Service]
User=hk-desktop
Group=hk-desktop
WorkingDirectory=/home/hk-desktop
Environment=HOME=/home/hk-desktop
Environment=DISPLAY=:91
Environment=XDG_RUNTIME_DIR=/run/hk-lxqt
ExecStartPre=/bin/sleep 2
ExecStart=/usr/bin/dbus-run-session /usr/bin/startlxqt
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
''')
xml=subprocess.check_output(['docker','run','--rm','--entrypoint','cat','guacamole/guacamole:1.6.0','/usr/local/tomcat/conf/server.xml']).decode()
xml=xml.replace('port="8080"','port="39011" address="127.0.0.1"')
(P/'server.xml').write_text(xml)
(P/'guacamole.env').write_text('GUACD_HOSTNAME=127.0.0.1\nGUACD_PORT=4823\nJSON_ENABLED=true\nJSON_SECRET_KEY='+s['key']+'\n');(P/'guacamole.env').chmod(0o600)
for name in ['hk-guacd','hk-guacamole']:
 exists=subprocess.run(['docker','inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
 if exists:raise SystemExit('Container already exists; review before replacing: '+name)
run('docker','run','-d','--name','hk-guacd','--restart','unless-stopped','--network','host','--health-cmd','nc -z 127.0.0.1 4823 || exit 1','--health-interval','30s','--entrypoint','/opt/guacamole/sbin/guacd','guacamole/guacd:1.6.0','-f','-b','127.0.0.1','-l','4823')
run('docker','run','-d','--name','hk-guacamole','--restart','unless-stopped','--network','host','--env-file',str(P/'guacamole.env'),'-v',str(P/'server.xml')+':/usr/local/tomcat/conf/server.xml:ro','guacamole/guacamole:1.6.0')
run('systemctl','daemon-reload');run('systemctl','enable','--now','hk-lxqt-display','hk-lxqt-session')
