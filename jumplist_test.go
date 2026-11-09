package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"reflect"
	"testing"
)

func TestJumpTargetFromArgs(t *testing.T) {
	cases := map[string][]string{
		"overview":        {`C:\LagZap.exe`, "--jump=overview"},
		"settings":        {"--minimized", "--jump=settings"},
		"title:01ABC-x_9": {"--jump=title:01ABC-x_9"},
		"":                {"--jump=title:../../etc"},
		" ":               {},
	}
	for want, args := range cases {
		if want == " " {
			want = ""
		}
		if got := jumpTargetFromArgs(args); got != want {
			t.Errorf("%v: got %q, want %q", args, got, want)
		}
	}
	if got := jumpTargetFromArgs([]string{"--jump=title:"}); got != "" {
		t.Errorf("empty title id accepted: %q", got)
	}
}

func testLabels() JumpListLabels {
	return JumpListLabels{
		General: "General", Overview: "Overview", Settings: "Settings",
		Favorites: "Favorites", Recent: "Recent",
		InternetPing: "Internet Ping: {0}ms", InternetPingNone: "Internet Ping: -",
	}
}

func TestJumpCategoriesLayout(t *testing.T) {
	content := JumpListContent{
		Labels:    testLabels(),
		Favorites: []JumpListTitle{{ID: "wow", Name: "World of Warcraft"}, {ID: "bad id!", Name: "Skipped"}},
		Recent:    []JumpListTitle{{ID: "cs2", Name: "Counter-Strike 2"}},
	}
	icons := map[string]string{"ping": `C:\icons\ping.ico`, "title:wow": `C:\icons\wow.ico`}
	got := jumpCategories(content, "Internet Ping: 20ms", `C:\LagZap.exe`, icons)
	want := []jumpCategory{
		{Name: "General", Items: []jumpItem{
			{Title: "Overview", Target: "overview", Icon: `C:\LagZap.exe`},
			{Title: "Internet Ping: 20ms", Target: "ping", Icon: `C:\icons\ping.ico`},
			{Title: "Settings", Target: "settings", Icon: `C:\LagZap.exe`},
		}},
		{Name: "Favorites", Items: []jumpItem{{Title: "World of Warcraft", Target: "title:wow", Icon: `C:\icons\wow.ico`}}},
		{Name: "Recent", Items: []jumpItem{{Title: "Counter-Strike 2", Target: "title:cs2", Icon: `C:\LagZap.exe`}}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

// No favorites: the section is left out, not shown empty.
func TestJumpCategoriesWithoutFavorites(t *testing.T) {
	got := jumpCategories(JumpListContent{Labels: testLabels()}, "x", "exe", nil)
	if len(got) != 1 || got[0].Name != "General" {
		t.Fatalf("got %+v", got)
	}
}

func TestJumpPingText(t *testing.T) {
	l := testLabels()
	if got := jumpPingText(l, 20, true); got != "Internet Ping: 20ms" {
		t.Fatal(got)
	}
	if got := jumpPingText(l, 0, true); got != l.InternetPingNone {
		t.Fatal(got)
	}
	if got := jumpPingText(l, 20, false); got != l.InternetPingNone {
		t.Fatal(got)
	}
}

func TestIcoFromImageScalesAndWraps(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 200, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 200; x++ {
			src.Set(x, y, color.RGBA{200, 50, 50, 255})
		}
	}
	var jpg bytes.Buffer
	if err := jpeg.Encode(&jpg, src, nil); err != nil {
		t.Fatal(err)
	}
	ico, err := icoFromImage(jpg.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	var header [3]uint16
	_ = binary.Read(bytes.NewReader(ico[:6]), binary.LittleEndian, &header)
	if header != [3]uint16{0, 1, 1} || ico[6] != jumpIconSize || ico[7] != jumpIconSize {
		t.Fatalf("bad header % x", ico[:8])
	}
	size := binary.LittleEndian.Uint32(ico[14:18])
	offset := binary.LittleEndian.Uint32(ico[18:22])
	if int(offset+size) != len(ico) {
		t.Fatalf("entry %d+%d, file %d", offset, size, len(ico))
	}
	img, err := png.Decode(bytes.NewReader(ico[offset:]))
	if err != nil {
		t.Fatal(err)
	}
	// 2:1 source: centred band, transparent above and below.
	if _, _, _, a := img.At(jumpIconSize/2, 2).RGBA(); a != 0 {
		t.Fatal("top should be transparent")
	}
	if r, _, _, a := img.At(jumpIconSize/2, jumpIconSize/2).RGBA(); a == 0 || r>>8 < 180 {
		t.Fatal("centre should be the image")
	}
}

func mustPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, jumpIconSize, jumpIconSize))
	for i := range img.Pix {
		img.Pix[i] = 0xff
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
