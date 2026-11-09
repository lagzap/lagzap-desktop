package localproxy

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/lagzap/lagzap-desktop/constant"
	"github.com/lagzap/lagzap/adapter"
	mDNS "github.com/miekg/dns"
)

// lagZapRoots are the domains endpoints are discovered from, in order.
var lagZapRoots = []string{"lagzap-network.ir", "lagzap.network", "lagzap.one"}

// DevCoordinatorEndpoint is the local coordinator dev builds try before the
// discovered ones.
const DevCoordinatorEndpoint = "http://localhost:4000"

// buildEndpoints are the endpoints this build tries before discovery.
func buildEndpoints() []string {
	if constant.IsDevBuild() {
		return []string{DevCoordinatorEndpoint}
	}
	return nil
}

const (
	txtLookupTimeout = 3 * time.Second
	txtListGrace     = 250 * time.Millisecond
)

var errTXTLookupTimeout = errors.New("TXT lookup timed out")

func channelName(version string) string {
	v := strings.ToLower(strings.TrimSpace(version))
	switch {
	case strings.HasSuffix(v, "-alpha"), strings.Contains(v, "-alpha."):
		return "alpha"
	case strings.HasSuffix(v, "-beta"), strings.Contains(v, "-beta."):
		return "beta"
	case strings.HasSuffix(v, "-dev"), strings.Contains(v, "-dev."):
		return "dev"
	default:
		return "prod"
	}
}

// ChannelHost is the channel's domain on the first root.
func ChannelHost(version string) string {
	return channelDomains(version)[0]
}

// channelDomains is the channel's domain on every root, in order.
func channelDomains(version string) []string {
	channel := channelName(version)
	out := make([]string, 0, len(lagZapRoots))
	for _, root := range lagZapRoots {
		out = append(out, channel+"."+root)
	}
	return out
}

// txtLookup returns the endpoints a domain's TXT record lists.
type txtLookup func(ctx context.Context, host string) ([]string, error)

// channelEndpoints reads the TXT record of every channel domain, each a comma
// separated list of available endpoints, and returns them in domain order.
// If no domain lists any, it falls back to the channel's domain on the first
// root; the lookup error is returned in that case alone.
//
// The wait is bounded here, not by ctx: the Windows resolver ignores ctx and
// takes 11s on a domain that does not exist. Once a domain has given a list,
// the others only get txtListGrace.
func channelEndpoints(ctx context.Context, lookup txtLookup, version string) ([]string, error) {
	type answer struct {
		index     int
		endpoints []string
		err       error
	}
	domains := channelDomains(version)
	answers := make(chan answer, len(domains))
	lookupCtx, cancel := context.WithTimeout(ctx, txtLookupTimeout)
	defer cancel()
	for i, domain := range domains {
		go func() {
			list, err := lookup(lookupCtx, domain)
			answers <- answer{i, list, err}
		}()
	}
	lists := make([][]string, len(domains))
	var errs []error
	deadline := time.NewTimer(txtLookupTimeout)
	defer deadline.Stop()
	listed := false
collect:
	for range domains {
		select {
		case a := <-answers:
			lists[a.index] = a.endpoints
			if a.err != nil {
				errs = append(errs, a.err)
			}
			if len(a.endpoints) > 0 && !listed {
				listed = true
				deadline.Reset(txtListGrace)
			}
		case <-deadline.C:
			errs = append(errs, errTXTLookupTimeout)
			break collect
		case <-ctx.Done():
			errs = append(errs, ctx.Err())
			break collect
		}
	}
	if listed {
		var out []string
		for _, list := range lists {
			out = append(out, list...)
		}
		return dedupePreserveOrder(out), nil
	}
	return []string{normalizeAPIBase(domains[0])}, errors.Join(errs...)
}

// BootstrapDNSServer is the DNS server the app's "bootstrap" rule sends the
// root domains to. TXT is read from it directly while the service is off, so
// discovery sees the same records with and without the service: the system
// resolver (often the home router) can hold an old record for minutes.
const BootstrapDNSServer = "8.8.8.8"

// channelTXTLookup asks the app's DNS router, else BootstrapDNSServer
// directly (no router yet: the bootstrap proxy starts first), and the system
// resolver only when both failed.
func channelTXTLookup(dns adapter.DNSRouter) txtLookup {
	return func(ctx context.Context, host string) ([]string, error) {
		if dns != nil {
			if endpoints, err := lookupTXTCDNs(ctx, dns, host); err == nil {
				return endpoints, nil
			}
		}
		if endpoints, err := lookupTXTServer(ctx, net.JoinHostPort(BootstrapDNSServer, "53"), host); err == nil {
			return endpoints, nil
		}
		return lookupTXTSystem(ctx, host)
	}
}

func DiscoverUpstream(ctx context.Context, dns adapter.DNSRouter, version string, coordinatorHosts []string) (string, error) {
	endpoints, txtErr := channelEndpoints(ctx, channelTXTLookup(dns), version)
	candidates := upstreamCandidates(coordinatorHosts, append(buildEndpoints(), endpoints...))
	for _, ep := range candidates {
		if probeURL(ctx, ep) {
			return ep, txtErr
		}
	}
	return candidates[0], txtErr
}

func upstreamCandidates(coordinatorHosts, endpoints []string) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, len(coordinatorHosts)+len(endpoints))
	add := func(raw string) {
		u := normalizeAPIBase(raw)
		if u == "" {
			return
		}
		if _, ok := seen[u]; ok {
			return
		}
		seen[u] = struct{}{}
		out = append(out, u)
	}
	for _, h := range coordinatorHosts {
		add(h)
	}
	for _, ep := range endpoints {
		add(ep)
	}
	return out
}

// DiscoverCoordinatorHosts returns the channel's coordinator hosts.
func DiscoverCoordinatorHosts(ctx context.Context, dns adapter.DNSRouter, version string) ([]string, error) {
	endpoints, err := channelEndpoints(ctx, channelTXTLookup(dns), version)
	return endpointHostnames(append(buildEndpoints(), endpoints...)), err
}

func endpointHostnames(endpoints []string) []string {
	out := make([]string, 0, len(endpoints))
	for _, ep := range endpoints {
		u, err := url.Parse(ep)
		if err != nil || u.Hostname() == "" {
			continue
		}
		host := u.Host
		if h, port, err := net.SplitHostPort(host); err == nil && port == "443" {
			host = h
		}
		out = append(out, host)
	}
	return dedupePreserveOrder(out)
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
	return txtAnswerEndpoints(resp), nil
}

func txtQuery(host string) *mDNS.Msg {
	msg := new(mDNS.Msg)
	msg.SetQuestion(mDNS.Fqdn(host), mDNS.TypeTXT)
	return msg
}

// lookupTXTServer asks one DNS server (host:port), over TCP when the UDP
// answer was truncated.
func lookupTXTServer(ctx context.Context, server, host string) ([]string, error) {
	client := &mDNS.Client{Net: "udp"}
	resp, _, err := client.ExchangeContext(ctx, txtQuery(host), server)
	if err == nil && resp.Truncated {
		client.Net = "tcp"
		resp, _, err = client.ExchangeContext(ctx, txtQuery(host), server)
	}
	if err != nil {
		return nil, err
	}
	return txtAnswerEndpoints(resp), nil
}

func txtAnswerEndpoints(resp *mDNS.Msg) []string {
	if resp == nil || resp.Rcode != mDNS.RcodeSuccess {
		return nil
	}
	var records []string
	for _, a := range resp.Answer {
		if rr, ok := a.(*mDNS.TXT); ok {
			records = append(records, strings.Join(rr.Txt, ""))
		}
	}
	return parseTXTEndpoints(records)
}

func lookupTXTSystem(ctx context.Context, host string) ([]string, error) {
	records, err := net.DefaultResolver.LookupTXT(ctx, host)
	if err != nil {
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) && dnsErr.IsNotFound {
			return nil, nil
		}
		return nil, err
	}
	return parseTXTEndpoints(records), nil
}

func parseTXTEndpoints(records []string) []string {
	var out []string
	for _, record := range records {
		for _, part := range strings.Split(record, ",") {
			if u := normalizeAPIBase(part); u != "" {
				out = append(out, u)
			}
		}
	}
	return dedupePreserveOrder(out)
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
