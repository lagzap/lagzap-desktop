package localproxy

import (
	"context"
	"errors"
	"net"
	"reflect"
	"testing"
	"time"

	mDNS "github.com/miekg/dns"
)

func fakeTXT(records map[string][]string, failed ...string) txtLookup {
	return func(_ context.Context, host string) ([]string, error) {
		for _, f := range failed {
			if f == host {
				return nil, errors.New("lookup failed")
			}
		}
		return parseTXTEndpoints(records[host]), nil
	}
}

func TestChannelDomainsFollowRootOrder(t *testing.T) {
	want := []string{"beta.lagzap-network.ir", "beta.lagzap.network", "beta.lagzap.one"}
	if got := channelDomains("v0.2.0-beta.3"); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if got := ChannelHost("0.2.0"); got != "prod.lagzap-network.ir" {
		t.Fatalf("got %v", got)
	}
}

// The endpoints in a TXT record are what gets used, not the domain holding it.
func TestListedEndpointsReplaceDomains(t *testing.T) {
	lookup := fakeTXT(map[string][]string{"beta.lagzap-network.ir": {"one.example.com, two.example.com"}})
	got, err := channelEndpoints(context.Background(), lookup, "1.0-beta")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"https://one.example.com", "https://two.example.com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	hosts := []string{"one.example.com", "two.example.com"}
	if names := endpointHostnames(got); !reflect.DeepEqual(names, hosts) {
		t.Fatalf("hostnames %v, want %v", names, hosts)
	}
}

func TestListsKeepRootOrderWithoutDuplicates(t *testing.T) {
	lookup := fakeTXT(map[string][]string{
		"beta.lagzap.one":        {"last.example.com,first.example.com"},
		"beta.lagzap-network.ir": {"first.example.com"},
	})
	got, _ := channelEndpoints(context.Background(), lookup, "1.0-beta")
	want := []string{"https://first.example.com", "https://last.example.com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// One domain failing is no error when another gave a list.
func TestLookupFailureIgnoredWhenAnotherDomainLists(t *testing.T) {
	lookup := fakeTXT(map[string][]string{"beta.lagzap.network": {"one.example.com"}}, "beta.lagzap-network.ir")
	got, err := channelEndpoints(context.Background(), lookup, "1.0-beta")
	if err != nil || !reflect.DeepEqual(got, []string{"https://one.example.com"}) {
		t.Fatalf("got %v, %v", got, err)
	}
}

// No list anywhere: the channel's domain on the first root is used and the
// failure reported.
func TestNoListFallsBackToFirstRoot(t *testing.T) {
	lookup := fakeTXT(nil, "beta.lagzap.one")
	got, err := channelEndpoints(context.Background(), lookup, "1.0-beta")
	if err == nil {
		t.Fatal("want the lookup error reported")
	}
	want := []string{"https://beta.lagzap-network.ir"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestUpstreamCandidatesCoordinatorHostsFirst(t *testing.T) {
	got := upstreamCandidates([]string{"backup.example.com"}, []string{"https://one.example.com", "https://backup.example.com"})
	want := []string{"https://backup.example.com", "https://one.example.com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// The Windows resolver ignores ctx on a domain that does not exist. A list
// from another domain must not wait for it.
func TestStuckDomainDoesNotHoldAList(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	lookup := func(_ context.Context, host string) ([]string, error) {
		if host == "beta.lagzap-network.ir" {
			return []string{"https://one.example.com"}, nil
		}
		<-release
		return nil, nil
	}
	start := time.Now()
	got, err := channelEndpoints(context.Background(), lookup, "1.0-beta")
	if err != nil || !reflect.DeepEqual(got, []string{"https://one.example.com"}) {
		t.Fatalf("got %v, %v", got, err)
	}
	if waited := time.Since(start); waited > txtLookupTimeout/2 {
		t.Fatalf("waited %s for the stuck domains", waited)
	}
}

// Every lookup stuck: the wait still ends, and the first root is used.
func TestAllDomainsStuckFallsBackToDomains(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	lookup := func(context.Context, string) ([]string, error) {
		<-release
		return nil, nil
	}
	got, err := channelEndpoints(context.Background(), lookup, "1.0-beta")
	if !errors.Is(err, errTXTLookupTimeout) || !reflect.DeepEqual(got, []string{"https://beta.lagzap-network.ir"}) {
		t.Fatalf("got %v, %v", got, err)
	}
}

// The bootstrap path reads TXT from the server it is given, the record the
// app's own DNS would see, not whatever the system resolver has cached.
func TestLookupTXTServerReadsGivenServer(t *testing.T) {
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &mDNS.Server{PacketConn: pc, Handler: mDNS.HandlerFunc(func(w mDNS.ResponseWriter, r *mDNS.Msg) {
		m := new(mDNS.Msg)
		m.SetReply(r)
		m.Answer = append(m.Answer, &mDNS.TXT{
			Hdr: mDNS.RR_Header{Name: r.Question[0].Name, Rrtype: mDNS.TypeTXT, Class: mDNS.ClassINET, Ttl: 60},
			Txt: []string{"new.example.com,", "other.example.com"},
		})
		_ = w.WriteMsg(m)
	})}
	go func() { _ = server.ActivateAndServe() }()
	defer server.Shutdown()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	got, err := lookupTXTServer(ctx, pc.LocalAddr().String(), "beta.lagzap-network.ir")
	want := []string{"https://new.example.com", "https://other.example.com"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, %v, want %v", got, err, want)
	}
}

// Coordinator hosts keep a port other than 443, so a dev server stays
// reachable.
func TestEndpointHostnamesKeepPort(t *testing.T) {
	got := endpointHostnames([]string{"http://localhost:4000", "https://coord.example.com", "https://other.example.com:443"})
	want := []string{"localhost:4000", "coord.example.com", "other.example.com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestIsLocalHost(t *testing.T) {
	for host, want := range map[string]bool{"localhost:4000": true, "127.0.0.1:4000": true, "[::1]:4000": true, "coord.example.com:443": false, "93.114.56.14:443": false} {
		if got := isLocalHost(host); got != want {
			t.Errorf("%s: got %v", host, got)
		}
	}
}
