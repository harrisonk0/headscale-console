package main

import (
	"net/netip"
	"testing"
)

func TestDestinations(t *testing.T) {
	for ip, want := range map[string]bool{"100.64.0.6": true, "100.64.0.2": true, "1.1.1.1": true, "127.0.0.1": false, "169.254.169.254": false, "100.96.0.1": false, "192.168.7.224": false, "10.0.0.1": false, "::1": false, "fd7a:115c:a1e0::1": false} {
		if got := allowed(netip.MustParseAddr(ip)); got != want {
			t.Errorf("%s: got %v want %v", ip, got, want)
		}
	}
}
