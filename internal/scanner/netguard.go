package scanner

import (
	"context"
	"net"
	neturl "net/url"
	"strings"
	"time"
)

// cgnat is the carrier-grade NAT range, which net.IP.IsPrivate does not cover.
var _, cgnat, _ = net.ParseCIDR("100.64.0.0/10")

func isPrivateIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || cgnat.Contains(ip)
}

// IsPrivateURL reports whether raw points at a loopback, private, link-local or
// otherwise internal address. Hostnames are resolved, so a public-looking name
// that maps to an internal IP is also treated as private. URLs that cannot be
// parsed are treated as private; names that do not resolve are not.
func IsPrivateURL(raw string) bool {
	u, err := neturl.Parse(raw)
	if err != nil {
		return true
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "" {
		return true
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return isPrivateIP(ip)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return false
	}
	for _, a := range addrs {
		if isPrivateIP(a.IP) {
			return true
		}
	}
	return false
}
