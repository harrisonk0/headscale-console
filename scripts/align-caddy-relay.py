from pathlib import Path
import shutil
main = Path('/etc/caddy/Caddyfile')
text = main.read_text()
start = text.index('https://headscale.movenis.dev {')
depth=0
for index in range(start + len('https://headscale.movenis.dev '), len(text)):
    if text[index] == '{': depth += 1
    elif text[index] == '}':
        depth -= 1
        if depth == 0:
            end=index+1
            break
block=text[start:end]
marker='    handle {\n        reverse_proxy 127.0.0.1:8080\n    }'
assert block.count(marker)==1, 'Headscale fallback changed; review before applying'
route='''    # Match the DERP server advertised to native clients in the current map.
    @hkremote_current_relay path /derp /derp/*
    handle @hkremote_current_relay {
        reverse_proxy 127.0.0.1:33445
    }

'''
if '@hkremote_current_relay' not in block:
    backup=Path('/etc/caddy/Caddyfile.before-relay-alignment-20261021')
    if not backup.exists(): shutil.copy2(main,backup)
    main.write_text(text[:start]+block.replace(marker,route+marker)+text[end:])
# Keep the alternate port-443 alias on the same physical relay, too.
p=Path('/etc/caddy/headscale-funnel.caddy')
s=p.read_text()
if '@hkremote_current_relay' not in s:
    backup=p.with_name(p.name+'.before-relay-alignment-20261021')
    if not backup.exists(): shutil.copy2(p,backup)
    anchor='    @headscale_protocol path '
    assert s.count(anchor)==1, 'Funnel listener changed; review before applying'
    s=s.replace(anchor,route+anchor)
    p.write_text(s)
print('Prepared matching DERP routes on both Headscale aliases.')

# Avoid overlapping protocol and DERP handlers, regardless of directive sorting.
s=p.read_text()
lines=s.splitlines()
for i,line in enumerate(lines):
    if "@headscale_protocol path " in line:
        lines[i]=" ".join(part for part in line.split(" ") if part not in ("/derp", "/derp/*"))
p.write_text("\n".join(lines)+"\n")
