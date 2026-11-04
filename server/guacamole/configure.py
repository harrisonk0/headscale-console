from pathlib import Path
import subprocess,shutil
root=Path('/opt/hk-guacamole');root.mkdir(exist_ok=True)
shutil.copy('/tmp/hk-guac-broker.py',root/'broker.py')
Path('/etc/systemd/system/hk-guacamole-broker.service').write_text('''[Unit]
Description=HK Remote authenticated Guacamole session broker
After=docker.service hk-lxqt-session.service
[Service]
ExecStart=/usr/bin/python3 /opt/hk-guacamole/broker.py
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
''')
p=Path('/etc/caddy/Caddyfile');text=p.read_text();backup=p.with_name('Caddyfile.before-guacamole');
if not backup.exists():shutil.copy(p,backup)
block='''    # HK Guacamole: fixed destinations, authenticated edge only
    handle /__hkguac-session {
        @guac_session_auth header X-HKRemote-Bridge {$HK_REMOTE_BRIDGE_SECRET}
        handle @guac_session_auth {
            request_header -X-HKRemote-Bridge
            reverse_proxy 127.0.0.1:39012
        }
        respond "Forbidden" 403
    }
    handle /__hkguac/* {
        @guac_auth header X-HKRemote-Bridge {$HK_REMOTE_BRIDGE_SECRET}
        handle @guac_auth {
            request_header -X-HKRemote-Bridge
            route {
                uri strip_prefix /__hkguac
                rewrite * /guacamole{uri}
                reverse_proxy 127.0.0.1:39011 {
                    flush_interval -1
                }
            }
        }
        respond "Forbidden" 403
    }
'''
if '# HK Guacamole:' not in text:p.write_text(text.replace('    # HK desktop private bridges',block+'\n    # HK desktop private bridges'))
subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','enable','--now','hk-guacamole-broker'],check=True)
