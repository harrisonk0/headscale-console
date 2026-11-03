#!/usr/bin/env python3
import json,os,pathlib,subprocess,time

def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True).stdout
if os.geteuid()!=0:raise SystemExit('Run as root on hk-cloud')
if pathlib.Path('/etc/systemd/system/hk-desktop-gateway.service').exists() and '/opt/hk-desktop/gateway' in pathlib.Path('/etc/systemd/system/hk-desktop-gateway.service').read_text():
    raise SystemExit('Custom gateway is already installed; bootstrap skipped.')
unit='''[Unit]
Description=HK Remote desktop network gateway (isolated access realm)
After=network-online.target headscale-desktop.service
[Service]
ExecStart=/usr/sbin/tailscaled --tun=userspace-networking --port=41644 --statedir=/var/lib/hk-desktop-gateway --state=/var/lib/hk-desktop-gateway/state --socket=/run/hk-desktop-gateway/tailscaled.sock
RuntimeDirectory=hk-desktop-gateway
RuntimeDirectoryMode=0700
StateDirectory=hk-desktop-gateway
StateDirectoryMode=0700
UMask=0077
Restart=on-failure
[Install]
WantedBy=multi-user.target
'''
pathlib.Path('/etc/systemd/system/hk-desktop-gateway.service').write_text(unit)
run('systemctl','daemon-reload');run('systemctl','enable','--now','hk-desktop-gateway')
cli=['tailscale','--socket=/run/hk-desktop-gateway/tailscaled.sock']
for _ in range(30):
    try:
        state=json.loads(run(*cli,'status','--json'));break
    except subprocess.CalledProcessError:time.sleep(.2)
if state.get('BackendState')!='Running':
    key=json.loads(run('headscale','-c','/etc/headscale-desktop/config.yaml','preauthkeys','create','--user','1','--expiration','2m','--output','json'))['key']
    path=pathlib.Path('/run/hk-desktop-gateway/join-key');path.write_text(key);os.chmod(path,0o600)
    try:
        run(*cli,'up','--login-server=http://127.0.0.1:39018','--auth-key=file:'+str(path),'--hostname=hk-desktop-bridge','--accept-dns=false','--accept-routes=false','--advertise-exit-node','--advertise-routes=100.64.0.0/24')
    finally:path.unlink(missing_ok=True)
nodes=json.loads(run('headscale','-c','/etc/headscale-desktop/config.yaml','nodes','list','--output','json'))
gateway=next(n for n in nodes if n.get('given_name')=='hk-desktop-bridge')
run('headscale','-c','/etc/headscale-desktop/config.yaml','nodes','approve-routes','--identifier',str(gateway['id']),'--routes','0.0.0.0/0,::/0,100.64.0.0/24')
print('Isolated gateway online; no device was added to the main homelab realm.')
