//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	appInfoUser32            = windows.NewLazySystemDLL("user32.dll")
	appInfoGdi32             = windows.NewLazySystemDLL("gdi32.dll")
	procPrivateExtractIconsW = appInfoUser32.NewProc("PrivateExtractIconsW")
	procGetIconInfo          = appInfoUser32.NewProc("GetIconInfo")
	procDestroyIcon          = appInfoUser32.NewProc("DestroyIcon")
	procAppInfoGetDC         = appInfoUser32.NewProc("GetDC")
	procAppInfoReleaseDC     = appInfoUser32.NewProc("ReleaseDC")
	procGetDIBits            = appInfoGdi32.NewProc("GetDIBits")
	procAppInfoDeleteObject  = appInfoGdi32.NewProc("DeleteObject")
	procAppInfoGetObjectW    = appInfoGdi32.NewProc("GetObjectW")
)

const appIconSize = 48

type iconInfo struct {
	fIcon    int32
	xHotspot uint32
	yHotspot uint32
	hbmMask  windows.Handle
	hbmColor windows.Handle
}

type bitmapInfoHeader struct {
	size          uint32
	width         int32
	height        int32
	planes        uint16
	bitCount      uint16
	compression   uint32
	sizeImage     uint32
	xPelsPerMeter int32
	yPelsPerMeter int32
	clrUsed       uint32
	clrImportant  uint32
}

type bitmapHeader struct {
	bmType       int32
	bmWidth      int32
	bmHeight     int32
	bmWidthBytes int32
	bmPlanes     uint16
	bmBitsPixel  uint16
	bmBits       uintptr
}

// readAppInfo reads an exe's display name (its file description, e.g.
// "Google Chrome") and icon as a PNG data URL. Either may be empty.
func readAppInfo(path string) AppInfo {
	return AppInfo{Name: fileDescription(path), Icon: exeIcon(path)}
}

func fileDescription(path string) string {
	size, err := windows.GetFileVersionInfoSize(path, nil)
	if err != nil || size == 0 {
		return ""
	}
	block := make([]byte, size)
	if err := windows.GetFileVersionInfo(path, 0, size, unsafe.Pointer(&block[0])); err != nil {
		return ""
	}
	var translations unsafe.Pointer
	var length uint32
	queries := []string{}
	if windows.VerQueryValue(unsafe.Pointer(&block[0]), `\VarFileInfo\Translation`, unsafe.Pointer(&translations), &length) == nil && length >= 4 {
		pairs := unsafe.Slice((*[2]uint16)(translations), length/4)
		for _, pair := range pairs {
			queries = append(queries, fmt.Sprintf(`\StringFileInfo\%04x%04x\FileDescription`, pair[0], pair[1]))
		}
	}
	queries = append(queries, `\StringFileInfo\040904b0\FileDescription`, `\StringFileInfo\040904e4\FileDescription`)
	for _, query := range queries {
		var value unsafe.Pointer
		var chars uint32
		if windows.VerQueryValue(unsafe.Pointer(&block[0]), query, unsafe.Pointer(&value), &chars) != nil || chars == 0 {
			continue
		}
		if text := windows.UTF16PtrToString((*uint16)(value)); text != "" {
			return text
		}
	}
	return ""
}

func exeIcon(path string) string {
	pathPtr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return ""
	}
	var hIcon windows.Handle
	var iconID uint32
	n, _, _ := procPrivateExtractIconsW.Call(
		uintptr(unsafe.Pointer(pathPtr)), 0, appIconSize, appIconSize,
		uintptr(unsafe.Pointer(&hIcon)), uintptr(unsafe.Pointer(&iconID)), 1, 0,
	)
	if n == 0 || n == 0xFFFFFFFF || hIcon == 0 {
		return ""
	}
	defer procDestroyIcon.Call(uintptr(hIcon))
	img := iconImage(hIcon)
	if img == nil {
		return ""
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func iconImage(hIcon windows.Handle) *image.NRGBA {
	var info iconInfo
	if ok, _, _ := procGetIconInfo.Call(uintptr(hIcon), uintptr(unsafe.Pointer(&info))); ok == 0 {
		return nil
	}
	if info.hbmMask != 0 {
		defer procAppInfoDeleteObject.Call(uintptr(info.hbmMask))
	}
	if info.hbmColor == 0 {
		return nil
	}
	defer procAppInfoDeleteObject.Call(uintptr(info.hbmColor))

	var bm bitmapHeader
	if ok, _, _ := procAppInfoGetObjectW.Call(uintptr(info.hbmColor), unsafe.Sizeof(bm), uintptr(unsafe.Pointer(&bm))); ok == 0 {
		return nil
	}
	width, height := int(bm.bmWidth), int(bm.bmHeight)
	if width <= 0 || height <= 0 || width > 256 || height > 256 {
		return nil
	}
	hdc, _, _ := procAppInfoGetDC.Call(0)
	if hdc == 0 {
		return nil
	}
	defer procAppInfoReleaseDC.Call(0, hdc)

	color := readBitmap(hdc, info.hbmColor, width, height)
	if color == nil {
		return nil
	}
	hasAlpha := false
	for i := 3; i < len(color); i += 4 {
		if color[i] != 0 {
			hasAlpha = true
			break
		}
	}
	var mask []byte
	if !hasAlpha && info.hbmMask != 0 {
		mask = readBitmap(hdc, info.hbmMask, width, height)
	}
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for i := 0; i < width*height; i++ {
		b, g, r, a := color[i*4], color[i*4+1], color[i*4+2], color[i*4+3]
		if !hasAlpha {
			a = 255
			if mask != nil && mask[i*4] != 0 {
				a = 0
			}
		} else if a != 0 && a != 255 {
			// Icon pixels are premultiplied.
			r = byte(int(r) * 255 / int(a))
			g = byte(int(g) * 255 / int(a))
			b = byte(int(b) * 255 / int(a))
		}
		img.Pix[i*4], img.Pix[i*4+1], img.Pix[i*4+2], img.Pix[i*4+3] = r, g, b, a
	}
	return img
}

// readBitmap reads a bitmap as top-down 32-bit BGRA.
func readBitmap(hdc uintptr, bitmap windows.Handle, width, height int) []byte {
	header := bitmapInfoHeader{
		width:    int32(width),
		height:   -int32(height),
		planes:   1,
		bitCount: 32,
	}
	header.size = uint32(unsafe.Sizeof(header))
	// BITMAPINFO is the header plus a colour table; 32-bit needs none, but
	// leave room for one entry.
	var bmi struct {
		header bitmapInfoHeader
		colors [4]uint32
	}
	bmi.header = header
	pixels := make([]byte, width*height*4)
	lines, _, _ := procGetDIBits.Call(hdc, uintptr(bitmap), 0, uintptr(height), uintptr(unsafe.Pointer(&pixels[0])), uintptr(unsafe.Pointer(&bmi)), 0)
	if lines == 0 {
		return nil
	}
	return pixels
}
