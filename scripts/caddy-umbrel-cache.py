from pathlib import Path
p=Path('/etc/caddy/Caddyfile');s=p.read_text()
old='''            uri strip_prefix /__hkremote
            reverse_proxy 100.64.0.6:80 {
                header_up -X-HKRemote-Bridge
                header_up Host 100.64.0.6
                header_up Origin http://100.64.0.6
            }'''
new='''            request_header -X-HKRemote-Bridge
            route {
                uri strip_prefix /__hkremote
                encode zstd gzip
                @remote_cached_assets {
                    path /assets/*
                    file {
                        root /var/cache/umbrel-assets
                    }
                }
                handle @remote_cached_assets {
                    root * /var/cache/umbrel-assets
                    header Cache-Control "public, max-age=31536000, immutable"
                    file_server {
                        precompressed br zstd gzip
                    }
                }
                @remote_dashboard_html {
                    method GET HEAD
                    header Accept *text/html*
                    not path /api/* /assets/* /locales/* /favicon/* /site.webmanifest /trpc*
                }
                handle @remote_dashboard_html {
                    root * /var/cache/umbrel-assets
                    rewrite * /index.html
                    header Cache-Control "no-store"
                    file_server
                }
                handle /umbrel-port-bridge.js {
                    root * /var/cache/umbrel-assets
                    header Cache-Control "no-store"
                    file_server
                }
                handle {
                    reverse_proxy 100.64.0.6:80 {
                        header_up -X-HKRemote-Bridge
                        header_up Host 100.64.0.6
                        header_up Origin http://100.64.0.6
                    }
                }
            }'''
if 'handle @remote_cached_assets' in s:
    raise SystemExit('Umbrel bridge asset cache is already configured.')
assert s.count(old)==1
backup=Path('/etc/caddy/Caddyfile.before-hkremote-cache')
if not backup.exists():backup.write_text(s)
p.write_text(s.replace(old,new))
