package localproxy

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/lagzap/lagzap/adapter"
	mDNS "github.com/miekg/dns"
)

const lagZapRoot = "lagzap.network"

func ChannelHost(version string) string {
	v := strings.ToLower(strings.TrimSpace(version))
	switch {
	case strings.HasSuffix(v, "-alpha"), strings.Contains(v, "-alpha."):
		return "alpha." + lagZapRoot
	case strings.HasSuffix(v, "-beta"), strings.Contains(v, "-beta."):
		return "beta." + lagZapRoot
	case strings.HasSuffix(v, "-dev"), strings.Contains(v, "-dev."):
		return "dev." + lagZapRoot
	case strings.HasSuffix(v, "-beta"), strings.Contains(v, "-beta."):
		return "beta." + lagZapRoot
	default:
		return "prod." + lagZapRoot
	}
}

func DiscoverUpstream(ctx context.Context, dns adapter.DNSRouter, version string) (string, error) {
	host := ChannelHost(version)
	fallback := normalizeAPIBase(host)
	if dns == nil {
		return fallback, nil
	}
	endpoints, err := lookupTXTCDNs(ctx, dns, host)
	if err != nil || len(endpoints) == 0 {
		return fallback, err
	}
	deduped := dedupePreserveOrder(endpoints)
	for _, ep := range deduped {
		if probeURL(ctx, ep) {
			return ep, nil
		}
	}
	return deduped[0], nil
}

func DiscoverCoordinatorHosts(ctx context.Context, dns adapter.DNSRouter, version string) ([]string, error) {
	host := ChannelHost(version)
	if dns == nil {
		return []string{host}, nil
	}
	endpoints, err := lookupTXTCDNs(ctx, dns, host)
	if err != nil || len(endpoints) == 0 {
		return []string{host}, err
	}
	out := make([]string, 0, len(endpoints))
	for _, ep := range dedupePreserveOrder(endpoints) {
		u, parseErr := url.Parse(ep)
		if parseErr != nil {
			continue
		}
		h := u.Hostname()
		if h == "" {
			continue
		}
		out = append(out, h)
	}
	if len(out) == 0 {
		return []string{host}, err
	}
	return dedupePreserveOrder(out), err
}

func lookupTXTCDNs(ctx context.Context, dns adapter.DNSRouter, host string) ([]string, error) {
	msg := &mDNS.Msg{
		MsgHdr: mDNS.MsgHdr{RecursionDesired: true},
		Question: []mDNS.Question{{
			Name:   mDNS.Fqdn(host),
			Qtype:  mDNS.TypeTXT,
			Qclass: mDNS.ClassINET,
		}},
	}
	resp, err := dns.Exchange(ctx, msg, adapter.DNSQueryOptions{})
	if err != nil {
		return nil, err
	}
	if resp.Rcode != mDNS.RcodeSuccess {
		return nil, nil
	}
	var out []string
	for _, a := range resp.Answer {
		rr, ok := a.(*mDNS.TXT)
		if !ok {
			continue
		}
		chunk := strings.Join(rr.Txt, "")
		for _, part := range strings.Split(chunk, ",") {
			if u := normalizeAPIBase(strings.TrimSpace(part)); u != "" {
				out = append(out, u)
			}
		}
	}
	return out, nil
}

func normalizeAPIBase(raw string) string {
	s := strings.TrimSpace(strings.TrimSuffix(raw, "/"))
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return ""
	}
	u.Path = ""
	u.RawQuery = ""
	u.Fragment = ""
	return strings.TrimSuffix(u.String(), "/")
}

func dedupePreserveOrder(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, x := range in {
		if x == "" {
			continue
		}
		if _, ok := seen[x]; ok {
			continue
		}
		seen[x] = struct{}{}
		out = append(out, x)
	}
	return out
}

func probeURL(ctx context.Context, base string) bool {
	u, err := url.Parse(base)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return false
	}
	probe := strings.TrimSuffix(u.String(), "/") + "/"
	pctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(pctx, http.MethodGet, probe, nil)
	if err != nil {
		return false
	}
	cli := &http.Client{
		Transport: http.DefaultTransport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	res, err := cli.Do(req)
	if err != nil {
		return false
	}
	_, _ = io.Copy(io.Discard, res.Body)
	_ = res.Body.Close()
	return res.StatusCode < 500
}
