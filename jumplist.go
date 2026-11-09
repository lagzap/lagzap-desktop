package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/lagzap/lagzap/adapter"
)

// The taskbar Jump List: General (Overview, Internet Ping, Settings), the
// favorite titles and the top recent ones. Clicking an entry starts LagZap
// with jumpArg; the running instance gets it and navigates there.

const (
	jumpArgPrefix = "--jump="
	// jumpEvent tells the frontend a jump is waiting (TakeJumpListRoute).
	jumpEvent = "jump-list-open"

	jumpTargetOverview = "overview"
	jumpTargetPing     = "ping"
	jumpTargetSettings = "settings"
	jumpTargetTitle    = "title:"

	// Windows writes the list to disk on every commit, so the ping entry is
	// refreshed at most this often.
	jumpPingRefresh  = 30 * time.Second
	jumpIconSize     = 48
	jumpIconMaxAge   = 7 * 24 * time.Hour
	jumpIconDownload = 10 * time.Second
	jumpIconMaxBytes = 4 << 20
)

var jumpTitleID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// JumpListTitle is a favorite or recent title.
type JumpListTitle struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	IconURL string `json:"iconUrl"`
}

// JumpListLabels are the translated texts. InternetPing holds {0} for the ms.
type JumpListLabels struct {
	General          string `json:"general"`
	Overview         string `json:"overview"`
	Settings         string `json:"settings"`
	Favorites        string `json:"favorites"`
	Recent           string `json:"recent"`
	InternetPing     string `json:"internetPing"`
	InternetPingNone string `json:"internetPingNone"`
}

// JumpListContent is what the frontend sends. The icons are PNG data URLs.
type JumpListContent struct {
	Labels       JumpListLabels  `json:"labels"`
	PingIcon     string          `json:"pingIcon"`
	SettingsIcon string          `json:"settingsIcon"`
	Favorites    []JumpListTitle `json:"favorites"`
	Recent       []JumpListTitle `json:"recent"`
}

type jumpItem struct {
	Title     string
	Target    string
	Icon      string // .ico path, or the exe for its own icon
	IconIndex int
}

type jumpCategory struct {
	Name  string
	Items []jumpItem
}

// jumpTargetFromArgs returns the jump target in the command line, if any.
func jumpTargetFromArgs(args []string) string {
	for _, arg := range args {
		if !strings.HasPrefix(arg, jumpArgPrefix) {
			continue
		}
		target := strings.TrimPrefix(arg, jumpArgPrefix)
		switch target {
		case jumpTargetOverview, jumpTargetPing, jumpTargetSettings:
			return target
		}
		if id, ok := strings.CutPrefix(target, jumpTargetTitle); ok && jumpTitleID.MatchString(id) {
			return target
		}
	}
	return ""
}

// jumpCategories lays out the list. icons maps a target to its .ico file;
// targets without one use the exe's icon.
func jumpCategories(content JumpListContent, pingText, exe string, icons map[string]string) []jumpCategory {
	item := func(title, target string) jumpItem {
		if icon := icons[target]; icon != "" {
			return jumpItem{Title: title, Target: target, Icon: icon}
		}
		return jumpItem{Title: title, Target: target, Icon: exe}
	}
	titles := func(list []JumpListTitle) []jumpItem {
		var out []jumpItem
		for _, t := range list {
			if jumpTitleID.MatchString(t.ID) && strings.TrimSpace(t.Name) != "" {
				out = append(out, item(t.Name, jumpTargetTitle+t.ID))
			}
		}
		return out
	}
	l := content.Labels
	categories := []jumpCategory{{Name: l.General, Items: []jumpItem{
		item(l.Overview, jumpTargetOverview),
		item(pingText, jumpTargetPing),
		item(l.Settings, jumpTargetSettings),
	}}}
	if favorites := titles(content.Favorites); len(favorites) > 0 {
		categories = append(categories, jumpCategory{Name: l.Favorites, Items: favorites})
	}
	if recent := titles(content.Recent); len(recent) > 0 {
		categories = append(categories, jumpCategory{Name: l.Recent, Items: recent})
	}
	return categories
}

func jumpPingText(labels JumpListLabels, ping int32, ok bool) string {
	if !ok || ping <= 0 {
		return labels.InternetPingNone
	}
	return strings.ReplaceAll(labels.InternetPing, "{0}", fmt.Sprint(ping))
}

type jumpListManager struct {
	mu      sync.Mutex
	content *JumpListContent
	pending string
	ping    func() (int32, bool)
	wake    chan struct{}
	start   sync.Once
}

var jumpList = &jumpListManager{wake: make(chan struct{}, 1)}

func (m *jumpListManager) setPending(target string) {
	m.mu.Lock()
	m.pending = target
	m.mu.Unlock()
}

func (m *jumpListManager) takePending() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	target := m.pending
	m.pending = ""
	return target
}

func (m *jumpListManager) set(ctx context.Context, content JumpListContent, ping func() (int32, bool)) {
	m.mu.Lock()
	m.content = &content
	m.ping = ping
	m.mu.Unlock()
	m.start.Do(func() { go m.run(ctx) })
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

// run builds the list whenever the content or the shown ping changes.
func (m *jumpListManager) run(ctx context.Context) {
	exe, err := os.Executable()
	if err != nil {
		fmt.Printf("jump list: %v\n", err)
		return
	}
	dir, err := jumpIconDir()
	if err != nil {
		fmt.Printf("jump list: icon folder: %v\n", err)
	}
	ticker := time.NewTicker(jumpPingRefresh)
	defer ticker.Stop()
	built := ""
	for {
		select {
		case <-ctx.Done():
			return
		case <-m.wake:
		case <-ticker.C:
		}
		m.mu.Lock()
		content, pingOf := m.content, m.ping
		m.mu.Unlock()
		if content == nil {
			continue
		}
		var ping int32
		var ok bool
		if pingOf != nil {
			ping, ok = pingOf()
		}
		icons := jumpIcons(ctx, dir, *content)
		categories := jumpCategories(*content, jumpPingText(content.Labels, ping, ok), exe, icons)
		key := fmt.Sprintf("%v", categories)
		if key == built {
			continue
		}
		if err := applyJumpList(exe, categories); err != nil {
			fmt.Printf("jump list: %v\n", err)
			continue
		}
		built = key
	}
}

func jumpIconDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "lagzap", "jumplist")
	return dir, os.MkdirAll(dir, 0o755)
}

// jumpIcons writes the .ico files the list needs and returns them by target.
func jumpIcons(ctx context.Context, dir string, content JumpListContent) map[string]string {
	icons := map[string]string{}
	if dir == "" {
		return icons
	}
	for target, dataURL := range map[string]string{jumpTargetPing: content.PingIcon, jumpTargetSettings: content.SettingsIcon} {
		if path, err := jumpIconFromDataURL(dir, target, dataURL); err == nil {
			icons[target] = path
		}
	}
	for _, list := range [][]JumpListTitle{content.Favorites, content.Recent} {
		for _, t := range list {
			if !jumpTitleID.MatchString(t.ID) || t.IconURL == "" {
				continue
			}
			if path, err := jumpTitleIcon(ctx, dir, t); err == nil {
				icons[jumpTargetTitle+t.ID] = path
			}
		}
	}
	return icons
}

func jumpIconFromDataURL(dir, name, dataURL string) (string, error) {
	_, data, ok := strings.Cut(dataURL, ";base64,")
	if !ok {
		return "", errors.New("not a base64 data URL")
	}
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return "", err
	}
	ico, err := icoFromImage(raw)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(ico)
	path := filepath.Join(dir, name+"-"+hex.EncodeToString(sum[:4])+".ico")
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	return path, os.WriteFile(path, ico, 0o644)
}

// jumpTitleIcon downloads a title's icon once a week. The file name carries
// the URL's hash, so a new icon URL gets a new file.
func jumpTitleIcon(ctx context.Context, dir string, t JumpListTitle) (string, error) {
	sum := sha256.Sum256([]byte(t.IconURL))
	path := filepath.Join(dir, "title-"+t.ID+"-"+hex.EncodeToString(sum[:4])+".ico")
	if info, err := os.Stat(path); err == nil && time.Since(info.ModTime()) < jumpIconMaxAge {
		return path, nil
	}
	ctx, cancel := context.WithTimeout(ctx, jumpIconDownload)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.IconURL, nil)
	if err != nil {
		return "", err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("icon %s: status %d", t.IconURL, res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, jumpIconMaxBytes))
	if err != nil {
		return "", err
	}
	ico, err := icoFromImage(raw)
	if err != nil {
		return "", err
	}
	return path, os.WriteFile(path, ico, 0o644)
}

// icoFromImage turns a PNG, JPEG or GIF into a one-image .ico, scaled to
// jumpIconSize.
func icoFromImage(raw []byte) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, scaleImage(img, jumpIconSize)); err != nil {
		return nil, err
	}
	return icoFromPNG(pngData.Bytes(), jumpIconSize), nil
}

// icoFromPNG wraps PNG data in an .ico (PNG entries work since Vista).
func icoFromPNG(data []byte, size int) []byte {
	var out bytes.Buffer
	dim := byte(size)
	if size >= 256 {
		dim = 0
	}
	_ = binary.Write(&out, binary.LittleEndian, [3]uint16{0, 1, 1})
	out.Write([]byte{dim, dim, 0, 0})
	_ = binary.Write(&out, binary.LittleEndian, [2]uint16{1, 32})
	_ = binary.Write(&out, binary.LittleEndian, [2]uint32{uint32(len(data)), 22})
	out.Write(data)
	return out.Bytes()
}

// scaleImage fits img into a size×size square, keeping its aspect ratio,
// by averaging the source pixels under each target pixel.
func scaleImage(img image.Image, size int) *image.NRGBA {
	b := img.Bounds()
	out := image.NewNRGBA(image.Rect(0, 0, size, size))
	if b.Dx() == 0 || b.Dy() == 0 {
		return out
	}
	scale := float64(max(b.Dx(), b.Dy())) / float64(size)
	w, h := int(float64(b.Dx())/scale+0.5), int(float64(b.Dy())/scale+0.5)
	offX, offY := (size-w)/2, (size-h)/2
	for y := 0; y < h; y++ {
		y0 := b.Min.Y + int(float64(y)*scale)
		y1 := max(y0+1, b.Min.Y+int(float64(y+1)*scale))
		for x := 0; x < w; x++ {
			x0 := b.Min.X + int(float64(x)*scale)
			x1 := max(x0+1, b.Min.X+int(float64(x+1)*scale))
			var r, g, bl, a, n uint64
			for sy := y0; sy < min(y1, b.Max.Y); sy++ {
				for sx := x0; sx < min(x1, b.Max.X); sx++ {
					c := color.NRGBA64Model.Convert(img.At(sx, sy)).(color.NRGBA64)
					r, g, bl, a, n = r+uint64(c.R), g+uint64(c.G), bl+uint64(c.B), a+uint64(c.A), n+1
				}
			}
			if n > 0 {
				out.SetNRGBA(offX+x, offY+y, color.NRGBA{uint8(r / n >> 8), uint8(g / n >> 8), uint8(bl / n >> 8), uint8(a / n >> 8)})
			}
		}
	}
	return out
}

// SetJumpList updates the taskbar Jump List.
func (s *Service) SetJumpList(content JumpListContent) {
	jumpList.set(s.ctx, content, s.internetPing)
}

// TakeJumpListRoute returns the Jump List entry the user opened, once.
func (s *Service) TakeJumpListRoute() string {
	return jumpList.takePending()
}

// openJumpTarget records a Jump List click and tells the frontend.
func (s *Service) openJumpTarget(target string) {
	if target == "" {
		return
	}
	jumpList.setPending(target)
	if s.app != nil {
		s.app.Event.Emit(jumpEvent)
	}
}

// internetPing is the Network Status page's best internet ping.
func (s *Service) internetPing() (int32, bool) {
	if reporter, ok := s.coordinator.(adapter.InternetPingReporter); ok && reporter != nil {
		return reporter.BestInternetPing()
	}
	return 0, false
}
