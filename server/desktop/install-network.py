#!/usr/bin/env python3
"""Install an isolated WebVM access network; never joins/modifies the homelab realm."""
import json, os, pathlib, pwd, subprocess, yaml

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout

if os.geteuid()!=0:
    raise SystemExit('Run on hk-cloud as root')
try:
    account=pwd.getpwnam('headscale-desktop')
except KeyError:
    run('useradd','--system','--home-dir','/var/lib/headscale-desktop','--shell','/usr/sbin/nologin','headscale-desktop')
    account=pwd.getpwnam('headscale-desktop')
for directory in ['/etc/headscale-desktop','/var/lib/headscale-desktop']:
    pathlib.Path(directory).mkdir(mode=0o750,exist_ok=True)
    os.chown(directory,account.pw_uid,account.pw_gid)
config_path='/etc/headscale-desktop/config.yaml'
if not pathlib.Path(config_path).exists():
    c=yaml.safe_load(pathlib.Path('/etc/headscale/config.yaml').read_text())
    c.update(server_url='https://hk-funnel-test.tail7bbf4b.ts.net:10000',listen_addr='127.0.0.1:39018',metrics_listen_addr='127.0.0.1:9098',grpc_listen_addr='127.0.0.1:50448',unix_socket='/run/headscale-desktop/headscale.sock')
    c['noise']['private_key_path']='/var/lib/headscale-desktop/noise.key'
    c['prefixes']={'v4':'100.96.0.0/11','v6':'fd7a:115c:a1e0:abcd::/64','allocation':'sequential'}
    c['database']['sqlite']['path']='/var/lib/headscale-desktop/db.sqlite'
    c['derp']['server'].update(region_id=998,region_code='desktop',region_name='HK Desktop access',stun_listen_addr='127.0.0.1:3479',private_key_path='/var/lib/headscale-desktop/derp.key',automatically_add_embedded_derp_region=False,ipv4='',ipv6='')
    c['derp']['paths']=['/etc/headscale-desktop/derp.yaml']
    c['node']['ephemeral']['inactivity_timeout']='5m'
    c['policy']={'mode':'file','path':'/etc/headscale-desktop/policy.hujson'}
    c['dns']['base_domain']='desktop.internal'
    c['dns']['nameservers']['global']=['1.1.1.1','1.0.0.1']
    c['dns']['extra_records']=[{'name':name+'.desktop.internal','type':'A','value':ip} for name,ip in [('hk-cloud','100.64.0.2'),('hk-umbrel','100.64.0.6'),('hk-mac','100.64.0.1')]]
    c['tls_letsencrypt_cache_dir']='/var/lib/headscale-desktop/cache'
    pathlib.Path(config_path).write_text(yaml.safe_dump(c,sort_keys=False))
    os.chmod(config_path,0o640);os.chown(config_path,account.pw_uid,account.pw_gid)
    pathlib.Path('/etc/headscale-desktop/derp.yaml').write_text(yaml.safe_dump({'regions':{998:{'regionid':998,'regioncode':'desktop','regionname':'HK Desktop access','nodes':[{'name':'desktop-relay','regionid':998,'hostname':'hk-funnel-test.tail7bbf4b.ts.net','derpport':10000,'stunport':-1}]}}}))
    pathlib.Path('/etc/headscale-desktop/policy.hujson').write_text(json.dumps({'acls':[{'action':'accept','src':['*'],'dst':['*:*']}]}))
unit='''[Unit]
Description=Private HK Remote desktop access network
After=network-online.target
[Service]
User=headscale-desktop
Group=headscale-desktop
ExecStart=/usr/bin/headscale --config /etc/headscale-desktop/config.yaml serve
RuntimeDirectory=headscale-desktop
RuntimeDirectoryMode=0750
StateDirectory=headscale-desktop
StateDirectoryMode=0700
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
[Install]
WantedBy=multi-user.target
'''
pathlib.Path('/etc/systemd/system/headscale-desktop.service').write_text(unit)
run('runuser','-u','headscale-desktop','--','headscale','-c',config_path,'configtest')
run('systemctl','daemon-reload');run('systemctl','enable','--now','headscale-desktop')
print('Private desktop Headscale service configured. Main homelab config unchanged.')
