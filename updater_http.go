package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"
)

// The updater's providers default to an HTTP client with a 30s Timeout, which
// covers reading the whole body: on a slow internet an update that takes
// longer than that to download failed with "context deadline exceeded". Its
// client has no overall limit instead — a download takes as long as the line
// needs — but connecting and the server's first answer are bounded, and a
// download that receives nothing at all for updateStallTimeout is given up.
const (
	updateStallTimeout    = 60 * time.Second
	updateResponseTimeout = 30 * time.Second
	updateTLSTimeout      = 20 * time.Second
)

// errUpdateStalled: the download received nothing for updateStallTimeout.
var errUpdateStalled = errors.New("update download stalled: no data for " + updateStallTimeout.String())

func updateHTTPClient() *http.Client {
	return newUpdateHTTPClient(updateStallTimeout)
}

func newUpdateHTTPClient(stall time.Duration) *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.ResponseHeaderTimeout = updateResponseTimeout
	tr.TLSHandshakeTimeout = updateTLSTimeout
	return &http.Client{Transport: &stallTransport{base: tr, idle: stall}}
}

// stallTransport ends a response whose body sends nothing for idle.
type stallTransport struct {
	base http.RoundTripper
	idle time.Duration
}

func (t *stallTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	ctx, cancel := context.WithCancelCause(req.Context())
	resp, err := t.base.RoundTrip(req.WithContext(ctx))
	if err != nil {
		cancel(nil)
		return nil, err
	}
	body := &stallBody{ReadCloser: resp.Body, idle: t.idle, cancel: cancel}
	body.timer = time.AfterFunc(t.idle, func() { cancel(errUpdateStalled) })
	body.ctx = ctx
	resp.Body = body
	return resp, nil
}

// stallBody restarts its timer on every byte received.
type stallBody struct {
	io.ReadCloser
	ctx    context.Context
	idle   time.Duration
	timer  *time.Timer
	cancel context.CancelCauseFunc
	once   sync.Once
}

func (b *stallBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if n > 0 {
		b.timer.Reset(b.idle)
	}
	if err != nil && !errors.Is(err, io.EOF) && errors.Is(context.Cause(b.ctx), errUpdateStalled) {
		return n, errUpdateStalled
	}
	return n, err
}

func (b *stallBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(func() {
		b.timer.Stop()
		b.cancel(nil)
	})
	return err
}
