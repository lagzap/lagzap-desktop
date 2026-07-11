package localproxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

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
