package main

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"sync"
	"time"
)

// Discord Rich Presence: the user's Discord status shows LagZap and the game
// it is optimizing. LagZap talks to the Discord app on this PC through its
// local pipe; nothing goes over the network and no Discord login is needed.
// Without Discord running nothing happens, and LagZap retries quietly.

// discordAppID is the LagZap application in the Discord Developer Portal (not
// a secret); its name is what Discord shows after "Playing".
const discordAppID = "1355850693155749948"

const (
	// discordLogoAsset is the Rich Presence art asset with the LagZap logo
	// (Developer Portal → Rich Presence → Art Assets).
	discordLogoAsset = "lagzap"
	discordSiteURL   = "https://lagzap.com"
	// discordServerURL is the LagZap Discord server (an invite that never
	// expires).
	discordServerURL = "https://discord.gg/spshhDFcbw"

	// Discord accepts about 5 updates per 20 seconds.
	discordMinSendGap = 4 * time.Second
	// discordRetry: how often a closed Discord is looked for again.
	discordRetry = 15 * time.Second

	discordOpHandshake = 0
	discordOpFrame     = 1
	discordOpClose     = 2
	discordMaxFrame    = 1 << 20
)

// DiscordPresence is what the status shows; Details empty clears it.
type DiscordPresence struct {
	// Details is the first line (the game), State the second.
	Details string `json:"details"`
	State   string `json:"state"`
	// GameIconURL is the large image (the game); the LagZap logo is the
	// small one. Empty: the LagZap logo alone.
	GameIconURL string `json:"gameIconUrl"`
	GameName    string `json:"gameName"`
	// StartMs is when the game session started (Unix ms; 0: no timer).
	StartMs int64 `json:"startMs"`
	// ButtonLabel is the "Get LagZap" button and ServerButtonLabel the "Join
	// our Discord" one, in the UI language (empty: no button).
	ButtonLabel       string `json:"buttonLabel"`
	ServerButtonLabel string `json:"serverButtonLabel"`
}

type discordPresence struct {
	mu      sync.Mutex
	want    *DiscordPresence
	wake    chan struct{}
	started bool
}

var presence = &discordPresence{wake: make(chan struct{}, 1)}

// SetDiscordPresence shows p as the user's Discord status; nil clears it.
func (s *Service) SetDiscordPresence(p *DiscordPresence) {
	if discordAppID == "" {
		return
	}
	if p != nil && p.Details == "" {
		p = nil
	}
	presence.mu.Lock()
	presence.want = p
	if !presence.started {
		presence.started = true
		go presence.run()
	}
	presence.mu.Unlock()
	select {
	case presence.wake <- struct{}{}:
	default:
	}
}

func (d *discordPresence) wanted() *DiscordPresence {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.want == nil {
		return nil
	}
	p := *d.want
	return &p
}

// run keeps Discord showing the latest wanted presence: it connects when
// Discord is running, sends changes no faster than Discord allows, and
// reconnects after Discord restarts.
func (d *discordPresence) run() {
	var (
		conn     *discordConn
		sent     *DiscordPresence
		sentAny  bool
		lastSend time.Time
	)
	retry := time.NewTimer(0)
	defer retry.Stop()
	for {
		select {
		case <-d.wake:
		case <-retry.C:
		}
		want := d.wanted()
		if conn == nil {
			if want == nil {
				continue // nothing to show: no need for Discord
			}
			c, err := dialDiscord(discordAppID)
			if err != nil {
				retry.Reset(discordRetry)
				continue
			}
			conn, sent, sentAny = c, nil, false
		}
		if sentAny && reflect.DeepEqual(want, sent) {
			continue
		}
		if wait := discordMinSendGap - time.Since(lastSend); wait > 0 {
			retry.Reset(wait)
			continue
		}
		lastSend = time.Now()
		if err := conn.setActivity(want); err != nil {
			conn.close()
			conn = nil
			retry.Reset(discordRetry)
			continue
		}
		sent, sentAny = want, true
		if want == nil {
			// Cleared: let go of Discord until there is something to show.
			conn.close()
			conn = nil
		}
	}
}

type discordConn struct {
	rw io.ReadWriteCloser
}

func dialDiscord(appID string) (*discordConn, error) {
	var lastErr error
	for i := 0; i < 10; i++ {
		rw, err := openDiscordPipe(i)
		if err != nil {
			lastErr = err
			continue
		}
		c := &discordConn{rw: rw}
		if err := c.write(discordOpHandshake, map[string]any{"v": 1, "client_id": appID}); err != nil {
			c.close()
			lastErr = err
			continue
		}
		op, body, err := c.read()
		if err != nil || op != discordOpFrame {
			c.close()
			lastErr = fmt.Errorf("discord handshake: op=%d %s %v", op, body, err)
			continue
		}
		return c, nil
	}
	if lastErr == nil {
		lastErr = errors.New("discord is not running")
	}
	return nil, lastErr
}

func (c *discordConn) setActivity(p *DiscordPresence) error {
	var activity any
	if p != nil {
		activity = discordActivity(p)
	}
	nonce := make([]byte, 8)
	_, _ = rand.Read(nonce)
	err := c.write(discordOpFrame, map[string]any{
		"cmd":   "SET_ACTIVITY",
		"args":  map[string]any{"pid": os.Getpid(), "activity": activity},
		"nonce": hex.EncodeToString(nonce),
	})
	if err != nil {
		return err
	}
	op, body, err := c.read()
	if err != nil {
		return err
	}
	if op == discordOpClose {
		return fmt.Errorf("discord closed: %s", body)
	}
	var reply struct {
		Evt  string `json:"evt"`
		Data struct {
			Message string `json:"message"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &reply) == nil && reply.Evt == "ERROR" {
		return fmt.Errorf("discord: %s", reply.Data.Message)
	}
	return nil
}

// discordActivity is p as Discord's activity object.
func discordActivity(p *DiscordPresence) map[string]any {
	assets := map[string]any{"large_image": discordLogoAsset, "large_text": "LagZap"}
	if p.GameIconURL != "" {
		assets = map[string]any{
			"large_image": p.GameIconURL,
			"large_text":  discordText(p.GameName),
			"small_image": discordLogoAsset,
			"small_text":  "LagZap",
		}
	}
	activity := map[string]any{
		"details": discordText(p.Details),
		"assets":  assets,
	}
	if p.State != "" {
		activity["state"] = discordText(p.State)
	}
	if p.StartMs > 0 {
		activity["timestamps"] = map[string]any{"start": p.StartMs}
	}
	var buttons []map[string]string
	if p.ButtonLabel != "" {
		buttons = append(buttons, map[string]string{"label": discordButtonText(p.ButtonLabel), "url": discordSiteURL})
	}
	if p.ServerButtonLabel != "" {
		buttons = append(buttons, map[string]string{"label": discordButtonText(p.ServerButtonLabel), "url": discordServerURL})
	}
	if len(buttons) > 0 {
		activity["buttons"] = buttons
	}
	return activity
}

// discordText fits Discord's limits: 2 to 128 characters.
func discordText(s string) string {
	r := []rune(s)
	if len(r) > 128 {
		r = append(r[:127], '…')
	}
	for len(r) < 2 {
		r = append(r, ' ')
	}
	return string(r)
}

// discordButtonText fits a button label: at most 32 characters.
func discordButtonText(s string) string {
	r := []rune(s)
	if len(r) > 32 {
		r = r[:32]
	}
	return string(r)
}

func (c *discordConn) write(op uint32, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	_ = binary.Write(&buf, binary.LittleEndian, op)
	_ = binary.Write(&buf, binary.LittleEndian, uint32(len(body)))
	buf.Write(body)
	_, err = c.rw.Write(buf.Bytes())
	return err
}

func (c *discordConn) read() (uint32, []byte, error) {
	var head [8]byte
	if _, err := io.ReadFull(c.rw, head[:]); err != nil {
		return 0, nil, err
	}
	op := binary.LittleEndian.Uint32(head[:4])
	size := binary.LittleEndian.Uint32(head[4:])
	if size > discordMaxFrame {
		return 0, nil, fmt.Errorf("discord frame of %d bytes", size)
	}
	body := make([]byte, size)
	if _, err := io.ReadFull(c.rw, body); err != nil {
		return 0, nil, err
	}
	return op, body, nil
}

func (c *discordConn) close() {
	if c != nil && c.rw != nil {
		_ = c.rw.Close()
	}
}
