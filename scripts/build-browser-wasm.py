"""Build the pinned Tailscale module with a browser-only DERP map adapter.

A private build copy leaves the dependency cache untouched. The adapter runs before
LocalBackend configures its transport, preserving region IDs and node identity.
"""
import shutil
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parent.parent
subprocess.run(["go", "mod", "download"], cwd=root, check=True)
cache = pathlib.Path(subprocess.check_output(["go", "env", "GOMODCACHE"], cwd=root, text=True).strip())
source = cache / "tailscale.com@v1.102.4/ipn/ipnlocal/local.go"
text = source.read_text()
marker = "func (b *LocalBackend) SetControlClientStatus(c controlclient.Client, st controlclient.Status) {"
assert text.count(marker) == 1, "Pinned Tailscale adapter location changed"
adapter = '''
	// Browser transport alias: preserve DERP region identity while routing its
	// WebSocket connection through the fixed-origin proxy. Copy shared maps.
	proxy := js.Global().Get("__meshRelayProxy")
	origin := js.Global().Get("__meshRelayOrigin")
	if proxy.Type() == js.TypeString && origin.Type() == js.TypeString && proxy.String() != "" && st.NetMap != nil && st.NetMap.DERPMap != nil {
		nm := *st.NetMap
		nm.DERPMap = nm.DERPMap.Clone()
		skippedSTUN := 0
		for id, region := range nm.DERPMap.Regions {
			// The JavaScript DERP dialer selects Nodes[0] without checking
			// STUNOnly. Browser clients cannot use UDP STUN endpoints.
			nodes := region.Nodes[:0]
			for _, node := range region.Nodes {
				if node == nil || node.STUNOnly {
					skippedSTUN++
					continue
				}
				if node.HostName == origin.String() {
					node.HostName = proxy.String()
					node.CertName = ""
					node.IPv4, node.IPv6 = "", ""
					node.DERPPort = 443
					node.STUNPort = -1
				}
				nodes = append(nodes, node)
			}
			region.Nodes = nodes
			if len(nodes) == 0 {
				delete(nm.DERPMap.Regions, id)
			}
		}
		if skippedSTUN > 0 {
			b.logf("browser DERP adapter: skipped %d STUN-only endpoint(s)", skippedSTUN)
		}
		st.NetMap = &nm
	}
'''
text = text.replace('import (', 'import (\n "syscall/js"', 1).replace(marker, marker + adapter)
build = root / ".build-wasm"
build.mkdir(exist_ok=True)
module = build / "tailscale"
if not module.exists(): shutil.copytree(source.parents[2], module)
(module / "ipn/ipnlocal/local.go").chmod(0o644)
(module / "ipn/ipnlocal/local.go").write_text(text)
modfile = build / "browser.mod"
modfile.write_text((root / "go.mod").read_text() + "\nreplace tailscale.com => " + str(module) + "\n")
(build / "browser.sum").write_bytes((root / "go.sum").read_bytes())
out = root / "package/tailscale/pkg"
out.mkdir(exist_ok=True)
import os
env = dict(os.environ, GOOS="js", GOARCH="wasm")
subprocess.run(["go", "build", "-modfile=" + str(modfile), "-trimpath", "-ldflags", "-s -w -X tailscale.com/version.shortStamp=1.102.4 -X tailscale.com/version.longStamp=1.102.4-MeshBrowser", "-o", str(out / "tailscale.wasm"), "./package/tailscale/tailscale.go"], cwd=root, env=env, check=True)
goroot = pathlib.Path(subprocess.check_output(["go", "env", "GOROOT"], text=True).strip())
(out / "wasm_exec.js").write_bytes((goroot / "lib/wasm/wasm_exec.js").read_bytes())
