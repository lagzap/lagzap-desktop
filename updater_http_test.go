package main

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// serveSlowly writes chunks with a pause between them.
func serveSlowly(chunks int, pause time.Duration) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		flusher := w.(http.Flusher)
		w.WriteHeader(http.StatusOK)
		for i := 0; i < chunks; i++ {
			_, _ = w.Write([]byte("0123456789"))
			flusher.Flush()
			time.Sleep(pause)
		}
	}))
}

// A slow but steady download takes as long as it needs: well past the stall
// limit in total, never that long without data.
func TestUpdateDownloadSlowButSteadyFinishes(t *testing.T) {
	srv := serveSlowly(8, 60*time.Millisecond) // ~0.5s in all
	defer srv.Close()
	client := newUpdateHTTPClient(200 * time.Millisecond)
	resp, err := client.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("slow download failed: %v", err)
	}
	if len(data) != 80 {
		t.Fatalf("got %d bytes, want 80", len(data))
	}
}

// A download that stops sending is given up after the stall limit, saying so.
func TestUpdateDownloadStallIsGivenUp(t *testing.T) {
	srv := serveSlowly(2, 2*time.Second)
	defer srv.Close()
	client := newUpdateHTTPClient(200 * time.Millisecond)
	resp, err := client.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	start := time.Now()
	_, err = io.ReadAll(resp.Body)
	if !errors.Is(err, errUpdateStalled) {
		t.Fatalf("err %v, want a stall", err)
	}
	if took := time.Since(start); took > time.Second {
		t.Fatalf("gave up after %v, want about the stall limit", took)
	}
}
