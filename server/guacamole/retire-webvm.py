from pathlib import Path
import subprocess,shutil
p=Path('/etc/caddy/Caddyfile');s=p.read_text();backup=p.with_name('Caddyfile.before-webvm-retirement')
if not backup.exists():shutil.copy(p,backup)
for route in ['/__hkdesktop-base/*','/__hkdesktop/*','/__hkdesktop-network/*']:
 marker='    handle '+route+' {';start=s.find(marker)
 if start<0:continue
 depth=0;end=None
 for i in range(s.index('{',start),len(s)):
  if s[i]=='{':depth+=1
  elif s[i]=='}':
   depth-=1
   if depth==0:end=i+1;break
 if end:s=s[:start]+s[end:]
s=s.replace('import /etc/caddy/hk-desktop-funnel.caddy','')
p.write_text(s)
for name in ['hk-desktop-storage','hk-desktop-gateway','headscale-desktop']:
 subprocess.run(['systemctl','disable','--now',name],check=True)
print('WebVM services disabled. Previous data retained under /var/lib/hk-desktop.')
