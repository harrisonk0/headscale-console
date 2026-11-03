#!/usr/bin/env python3
import os,pathlib,shutil,subprocess
if os.geteuid()!=0:raise SystemExit('Run as root on hk-cloud')
source=pathlib.Path(__file__).parent
install=pathlib.Path('/opt/hk-desktop');install.mkdir(mode=0o755,exist_ok=True)
for name in ['storage.py','service.py']:
    shutil.copy2(source/name,install/name)
    os.chmod(install/name,0o644)
unit='''[Unit]
Description=HK Remote roaming desktop storage
After=network-online.target headscale-desktop.service
[Service]
User=headscale-desktop
Group=headscale-desktop
ExecStart=/usr/bin/python3 /opt/hk-desktop/service.py
WorkingDirectory=/opt/hk-desktop
StateDirectory=hk-desktop
StateDirectoryMode=0700
UMask=0077
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
[Install]
WantedBy=multi-user.target
'''
pathlib.Path('/etc/systemd/system/hk-desktop-storage.service').write_text(unit)
caddy=pathlib.Path('/etc/caddy/Caddyfile');s=caddy.read_text()
if '# HK desktop immutable base' not in s:
    shutil.copy2(caddy,str(caddy)+'.before-hk-desktop-base-v1')
    base='''
    # HK desktop immutable base
    handle /__hkdesktop-base/* {
        @desktop_base_auth header X-HKRemote-Bridge {$HK_REMOTE_BRIDGE_SECRET}
        handle @desktop_base_auth {
            request_header -X-HKRemote-Bridge
            uri strip_prefix /__hkdesktop-base
            root * /var/cache/hk-desktop-base
            file_server
        }
        respond "Forbidden" 403
    }
'''
    s=s.replace('https://headscale.movenis.dev {','https://headscale.movenis.dev {'+base,1)
    caddy.write_text(s)
if '# HK desktop private bridges' not in s:
    shutil.copy2(caddy,str(caddy)+'.before-hk-desktop-v1')
    block='''
    # HK desktop private bridges
    handle /__hkdesktop/* {
        @desktop_auth header X-HKRemote-Bridge {$HK_REMOTE_BRIDGE_SECRET}
        handle @desktop_auth {
            request_header -X-HKRemote-Bridge
            uri strip_prefix /__hkdesktop
            reverse_proxy 127.0.0.1:39009
        }
        respond "Forbidden" 403
    }
    handle /__hkdesktop-network/* {
        @desktop_network_auth header X-HKRemote-Bridge {$HK_REMOTE_BRIDGE_SECRET}
        handle @desktop_network_auth {
            request_header -X-HKRemote-Bridge
            uri strip_prefix /__hkdesktop-network
            @desktop_protocol path /key /ts2021 /derp /derp/*
            handle @desktop_protocol {
                reverse_proxy 127.0.0.1:39018
            }
            respond "Not found" 404
        }
        respond "Forbidden" 403
    }
'''
    s=s.replace('https://headscale.movenis.dev {','https://headscale.movenis.dev {'+block,1)
    s+='\nimport /etc/caddy/hk-desktop-funnel.caddy\n'
    caddy.write_text(s)
pathlib.Path('/etc/caddy/hk-desktop-funnel.caddy').write_text('''http://:39008 {
    bind 127.0.0.1
    @desktop_public_protocol path /key /ts2021 /machine/* /derp /derp/* /health
    handle @desktop_public_protocol {
        reverse_proxy 127.0.0.1:39018
    }
    respond "Not found" 404
}
''')
subprocess.run(['bash','-c','set -a; source /etc/caddy/hk-remote.env; set +a; caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && systemctl reload caddy'],check=True)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','hk-desktop-storage'],check=True,capture_output=True)
subprocess.run(['systemctl','restart','hk-desktop-storage'],check=True)
subprocess.run(['tailscale','--socket=/run/tailscale-funnel-test/tailscaled.sock','funnel','--bg','--tls-terminated-tcp=10000','tcp://127.0.0.1:39008'],check=True,capture_output=True)
print('Private storage service, guarded bridges and isolated relay installed.')
