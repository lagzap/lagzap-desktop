package main

import (
	"net/url"
	"testing"
)

func TestCheckoutURL(t *testing.T) {
	got := checkoutURL("https://lagzap.com", "", 7, 3, "USD", map[string]int64{"seats": 7, "max_hops": 2}, true, "0.3.0")
	u, err := url.Parse(got)
	if err != nil || u.Scheme != "https" || u.Host != "lagzap.com" || u.Path != "/checkout" {
		t.Fatalf("url: %s", got)
	}
	q := u.Query()
	for k, want := range map[string]string{"plan": "7", "period": "3", "currency": "USD", "o.seats": "7", "o.max_hops": "2", "src": "app", "v": "0.3.0", "upgrade": "1"} {
		if q.Get(k) != want {
			t.Errorf("%s = %q, want %q (%s)", k, q.Get(k), want, got)
		}
	}

	// The server's upgrade_url host wins over the configured site.
	got = checkoutURL("https://lagzap.com", "https://staging.lagzap.com/pricing?x=1", 1, 1, "EUR", nil, false, "dev")
	if u, _ := url.Parse(got); u.Host != "staging.lagzap.com" || u.Path != "/checkout" || u.Query().Get("x") != "" || u.Query().Has("upgrade") {
		t.Fatalf("override: %s", got)
	}
	// Same host: nothing changes; odd values are encoded.
	got = checkoutURL("https://lagzap.com", "https://lagzap.com/upgrade", 1, 12, "A&B", nil, false, "1.0 beta")
	if u, _ := url.Parse(got); u.Host != "lagzap.com" || u.Query().Get("currency") != "A&B" || u.Query().Get("v") != "1.0 beta" {
		t.Fatalf("encoding: %s", got)
	}
}
