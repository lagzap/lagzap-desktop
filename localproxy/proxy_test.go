package localproxy

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

func TestStartSkipsRestartWhenTargetUnchanged(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(upstream.Close)

	// An ephemeral port, so a running app holding DefaultListen doesn't fail the test.
	cfg := Config{Listen: "127.0.0.1:0", Target: upstream.URL}
	proxy := New()
	if err := proxy.Start(cfg); err != nil {
		t.Fatalf("first start: %v", err)
	}
	t.Cleanup(func() { _ = proxy.Stop() })
	first := proxy.server
	if err := proxy.Start(cfg); err != nil {
		t.Fatalf("second start: %v", err)
	}
	if proxy.server != first {
		t.Fatal("expected proxy to skip restart when target unchanged")
	}
}
func TestBufferRequestBody(t *testing.T) {
	body := `{"entry":"test@example.com"}`
	req := httptest.NewRequest(http.MethodPost, "/check", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	if err := bufferRequestBody(req); err != nil {
		t.Fatalf("bufferRequestBody: %v", err)
	}

	got, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(got) != body {
		t.Fatalf("got body %q, want %q", got, body)
	}

	replay, err := req.GetBody()
	if err != nil {
		t.Fatalf("GetBody: %v", err)
	}
	replayed, err := io.ReadAll(replay)
	if err != nil {
		t.Fatalf("read replay body: %v", err)
	}
	if string(replayed) != body {
		t.Fatalf("replayed body %q, want %q", replayed, body)
	}
}

func TestOriginResolvePreservesWailsDevPort(t *testing.T) {
	got := cors.resolve("http://wails.localhost:9245", "")
	if got != "http://wails.localhost:9245" {
		t.Fatalf("got %q, want exact client origin with port", got)
	}
}

func TestProxyCorsResponseUsesClientOrigin(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"exists":true,"type":"email"}`))
	}))
	t.Cleanup(upstream.Close)

	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatalf("parse upstream url: %v", err)
	}

	proxy := httptest.NewServer(newHandler(handlerConfig{target: target}))
	t.Cleanup(proxy.Close)

	req, err := http.NewRequest(http.MethodPost, proxy.URL+"/check", strings.NewReader(`{"entry":"a@b.com"}`))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://wails.localhost:9245")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post through proxy: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "http://wails.localhost:9245" {
		t.Fatalf("Access-Control-Allow-Origin %q, want http://wails.localhost:9245", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Private-Network"); got != "true" {
		t.Fatalf("Access-Control-Allow-Private-Network %q, want true", got)
	}
}

func TestProxyForwardsRequestBody(t *testing.T) {
	wantBody := `{"entry":"test@example.com"}`
	var gotBody string

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("upstream read body: %v", err)
			http.Error(w, "read body failed", http.StatusInternalServerError)
			return
		}
		gotBody = string(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"exists":true,"type":"email"}`))
	}))
	t.Cleanup(upstream.Close)

	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatalf("parse upstream url: %v", err)
	}

	proxy := httptest.NewServer(newHandler(handlerConfig{target: target}))
	t.Cleanup(proxy.Close)

	resp, err := http.Post(proxy.URL+"/check", "application/json", strings.NewReader(wantBody))
	if err != nil {
		t.Fatalf("post through proxy: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", resp.StatusCode)
	}
	if gotBody != wantBody {
		t.Fatalf("upstream body %q, want %q", gotBody, wantBody)
	}
}

// A pooled keep-alive connection stays on the adapter it was dialed on. When
// the coordinator moves off an adapter, the next API request must not reuse
// one: login sat on a disabled PTP while ZLT X10 worked.
func TestTransportDropsPooledConnectionsWhenAdapterChanges(t *testing.T) {
	var dials atomic.Int32
	upstream := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	upstream.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			dials.Add(1)
		}
	}
	upstream.Start()
	t.Cleanup(upstream.Close)

	iface := "PTP"
	rt := &rebindingTransport{
		Transport: http.DefaultTransport.(*http.Transport).Clone(),
		bindIface: func() string { return iface },
	}
	client := &http.Client{Transport: rt}
	get := func() {
		t.Helper()
		res, err := client.Get(upstream.URL)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, res.Body)
		_ = res.Body.Close()
	}
	get()
	get()
	if n := dials.Load(); n != 1 {
		t.Fatalf("same adapter: %d connections, want 1 reused", n)
	}
	iface = "ZLT X10"
	get()
	if n := dials.Load(); n != 2 {
		t.Fatalf("after adapter change: %d connections, want a new one", n)
	}
}
