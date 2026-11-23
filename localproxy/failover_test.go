package localproxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func shortWaits(t *testing.T) {
	prev, prevLast := upstreamWait, lastUpstreamWait
	upstreamWait, lastUpstreamWait = 150*time.Millisecond, 300*time.Millisecond
	t.Cleanup(func() { upstreamWait, lastUpstreamWait = prev, prevLast })
}

func parseURLs(t *testing.T, raw ...string) []*url.URL {
	out := make([]*url.URL, 0, len(raw))
	for _, r := range raw {
		u, err := url.Parse(r)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, u)
	}
	return out
}

// An upstream that takes the request but never answers: a read moves to the
// next upstream, and later requests go there first.
func TestReadMovesToNextUpstreamWhenOneHangs(t *testing.T) {
	shortWaits(t)
	release := make(chan struct{})
	var hung atomic.Int32
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hung.Add(1)
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() { close(release); slow.Close() })
	var served atomic.Int32
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		served.Add(1)
		_, _ = io.WriteString(w, "ok")
	}))
	t.Cleanup(good.Close)

	proxy := httptest.NewServer(newHandler(handlerConfig{targets: parseURLs(t, slow.URL, good.URL)}))
	t.Cleanup(proxy.Close)

	for i := 0; i < 2; i++ {
		res, err := http.Get(proxy.URL + "/data")
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		_ = res.Body.Close()
		if res.StatusCode != http.StatusOK || string(body) != "ok" {
			t.Fatalf("request %d: %d %q", i, res.StatusCode, body)
		}
	}
	if hung.Load() != 1 || served.Load() != 2 {
		t.Fatalf("hanging upstream got %d, good one %d; want 1 and 2", hung.Load(), served.Load())
	}
}

// A write is sent again only when it never reached the first upstream.
func TestWriteMovesOnOnlyWhenTheDialFails(t *testing.T) {
	shortWaits(t)
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := dead.URL
	dead.Close()
	var body string
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(good.Close)

	proxy := httptest.NewServer(newHandler(handlerConfig{targets: parseURLs(t, deadURL, good.URL)}))
	t.Cleanup(proxy.Close)

	res, err := http.Post(proxy.URL+"/token", "application/json", strings.NewReader(`{"a":1}`))
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusCreated || body != `{"a":1}` {
		t.Fatalf("status %d body %q", res.StatusCode, body)
	}
}

// Every upstream silent: the app hears "slow to respond" (504), in time.
func TestAllUpstreamsSilentAnswers504(t *testing.T) {
	shortWaits(t)
	release := make(chan struct{})
	hang := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	})
	a, b := httptest.NewServer(hang), httptest.NewServer(hang)
	t.Cleanup(func() { close(release); a.Close(); b.Close() })

	proxy := httptest.NewServer(newHandler(handlerConfig{targets: parseURLs(t, a.URL, b.URL)}))
	t.Cleanup(proxy.Close)

	start := time.Now()
	res, err := http.Get(proxy.URL + "/data")
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusGatewayTimeout {
		t.Fatalf("status %d, want 504", res.StatusCode)
	}
	if took := time.Since(start); took > 2*time.Second {
		t.Fatalf("took %v", took)
	}
}

// An answer that is slow to stream after its headers is not cut off.
func TestAnswerAfterHeadersIsNotCutOff(t *testing.T) {
	shortWaits(t)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		time.Sleep(500 * time.Millisecond)
		_, _ = io.WriteString(w, "done")
	}))
	t.Cleanup(up.Close)
	proxy := httptest.NewServer(newHandler(handlerConfig{targets: parseURLs(t, up.URL)}))
	t.Cleanup(proxy.Close)

	res, err := http.Get(proxy.URL + "/data")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if string(body) != "done" {
		t.Fatalf("body %q", body)
	}
}
