package main

import (
	"encoding/json"
	"net"
	"testing"
)

// A fake Discord on the other end of the pipe: the activity arrives framed as
// Discord expects, and its reply is read back.
func TestDiscordSetActivityFrames(t *testing.T) {
	client, server := net.Pipe()
	defer server.Close()
	c := &discordConn{rw: client}
	defer c.close()

	got := make(chan map[string]any, 1)
	go func() {
		d := &discordConn{rw: server}
		op, body, err := d.read()
		if err != nil || op != discordOpFrame {
			got <- nil
			return
		}
		var msg map[string]any
		_ = json.Unmarshal(body, &msg)
		got <- msg
		_ = d.write(discordOpFrame, map[string]any{"cmd": "SET_ACTIVITY", "evt": nil})
	}()

	err := c.setActivity(&DiscordPresence{
		Details:           "Call of Duty",
		State:             "Frankfurt · 108 ms",
		GameIconURL:       "https://example.com/cod.png",
		GameName:          "Call of Duty",
		StartMs:           1700000000000,
		ButtonLabel:       "Get LagZap",
		ServerButtonLabel: "Join our Discord",
	})
	if err != nil {
		t.Fatal(err)
	}
	msg := <-got
	if msg == nil || msg["cmd"] != "SET_ACTIVITY" {
		t.Fatalf("got %v", msg)
	}
	activity := msg["args"].(map[string]any)["activity"].(map[string]any)
	assets := activity["assets"].(map[string]any)
	if buttons := activity["buttons"].([]any); len(buttons) != 2 || buttons[1].(map[string]any)["url"] != discordServerURL {
		t.Fatalf("buttons %v", activity["buttons"])
	}
	if activity["details"] != "Call of Duty" || assets["large_image"] != "https://example.com/cod.png" || assets["small_image"] != discordLogoAsset {
		t.Fatalf("activity %v", activity)
	}
}

func TestDiscordTextLimits(t *testing.T) {
	if got := discordText("a"); len([]rune(got)) != 2 {
		t.Fatalf("short text %q", got)
	}
	long := make([]rune, 200)
	for i := range long {
		long[i] = 'x'
	}
	if got := discordText(string(long)); len([]rune(got)) != 128 {
		t.Fatalf("long text has %d characters", len([]rune(got)))
	}
}
