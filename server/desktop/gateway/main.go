// Userspace gateway for the isolated desktop realm. Homelab connections use
// the host's existing client; this never installs routes or joins the main realm.
package main

import (
	"context"
	"golang.org/x/net/dns/dnsmessage"
	"io"
	"log"
	"net"
	"net/netip"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"tailscale.com/ipn"
	"tailscale.com/ipn/store"
	"tailscale.com/tsnet"
	"tailscale.com/types/logger"
)

var homelab = netip.MustParsePrefix("100.64.0.0/24")
var cgnat = netip.MustParsePrefix("100.64.0.0/10")

func allowed(ip netip.Addr) bool {
	return homelab.Contains(ip) || (ip.IsGlobalUnicast() && !ip.IsPrivate() &&
		!ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !cgnat.Contains(ip))
}
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	state, err := store.New(logger.Discard, "/var/lib/hk-desktop-gateway/state")
	if err != nil {
		log.Fatal(err)
	}
	server := &tsnet.Server{Dir: "/var/lib/hk-desktop-gateway", Store: state, Hostname: "hk-desktop-bridge", ControlURL: "http://127.0.0.1:39018"}
	defer server.Close()
	server.RegisterFallbackTCPHandler(func(src, dst netip.AddrPort) (func(net.Conn), bool) {
		if !allowed(dst.Addr()) {
			return nil, true
		}
		return func(in net.Conn) {
			defer in.Close()
			dial := net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
			out, err := dial.DialContext(ctx, "tcp", dst.String())
			if err != nil {
				return
			}
			defer out.Close()
			done := make(chan struct{})
			go func() {
				io.Copy(out, in)
				if c, ok := out.(*net.TCPConn); ok {
					c.CloseWrite()
				}
				close(done)
			}()
			io.Copy(in, out)
			in.Close()
			out.Close()
			<-done
		}, true
	})
	if _, err = server.Up(ctx); err != nil {
		log.Fatal(err)
	}
	lc, err := server.LocalClient()
	if err != nil {
		log.Fatal(err)
	}
	_, err = lc.EditPrefs(ctx, &ipn.MaskedPrefs{AdvertiseRoutesSet: true, Prefs: ipn.Prefs{AdvertiseRoutes: []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/0"), netip.MustParsePrefix("::/0"), homelab,
	}}})
	if err != nil {
		log.Fatal(err)
	}
	v4, _ := server.TailscaleIPs()
	dns, err := server.ListenPacket("udp4", net.JoinHostPort(v4.String(), "53"))
	if err != nil {
		log.Fatal(err)
	}
	defer dns.Close()
	go func() {
		semaphore := make(chan struct{}, 16)
		for {
			buf := make([]byte, 4096)
			n, addr, err := dns.ReadFrom(buf)
			if err != nil {
				return
			}
			select {
			case semaphore <- struct{}{}:
			default:
				continue
			}
			go func(q []byte, addr net.Addr) {
				defer func() { <-semaphore }()
				upstream := "1.1.1.1:53"
				var parser dnsmessage.Parser
				if _, err := parser.Start(q); err == nil {
					if question, err := parser.Question(); err == nil && strings.HasSuffix(strings.ToLower(question.Name.String()), ".mesh.movenis.dev.") {
						upstream = "100.100.100.100:53"
					}
				}
				conn, err := net.DialTimeout("udp", upstream, 3*time.Second)
				if err != nil {
					return
				}
				defer conn.Close()
				conn.SetDeadline(time.Now().Add(3 * time.Second))
				if _, err = conn.Write(q); err != nil {
					return
				}
				response := make([]byte, 4096)
				n, err := conn.Read(response)
				if err == nil {
					dns.WriteTo(response[:n], addr)
				}
			}(buf[:n], addr)
		}
	}()
	log.Print("Desktop bridge ready (TCP and DNS; no host routes changed)")
	<-ctx.Done()
}
