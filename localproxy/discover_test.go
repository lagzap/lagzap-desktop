package localproxy

import "testing"

func TestUpstreamCandidates(t *testing.T) {
	got := upstreamCandidates("1.0-dev", []string{"https://txt.example.com"}, []string{"dev.lagzap-network.ir"})
	want := []string{
		"https://dev.lagzap-network.ir",
		"https://txt.example.com",
		"https://dev.lagzap.network",
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestUpstreamCandidatesCoordinatorFirstWhenNoTXT(t *testing.T) {
	got := upstreamCandidates("1.0-dev", nil, []string{"dev.lagzap-network.ir", "backup.example.com"})
	want := []string{
		"https://dev.lagzap-network.ir",
		"https://backup.example.com",
		"https://dev.lagzap.network",
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestUpstreamCandidatesChannelFallbacksWhenNoCoordinatorOrTXT(t *testing.T) {
	got := upstreamCandidates("1.0-dev", nil, nil)
	want := []string{
		"https://dev.lagzap-network.ir",
		"https://dev.lagzap.network",
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestChannelCoordinatorHostnamesOnDNSFailure(t *testing.T) {
	got := channelCoordinatorHostnames("1.0-dev")
	want := []string{"dev.lagzap-network.ir", "dev.lagzap.network"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}
