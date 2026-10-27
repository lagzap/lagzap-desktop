//go:build windows

package main

import (
	"sync"
	"syscall"
	"unsafe"
)

var (
	user32                       = syscall.NewLazyDLL("user32.dll")
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	shell32                      = syscall.NewLazyDLL("shell32.dll")
	procShellExecuteW            = shell32.NewProc("ShellExecuteW")
	procSetWindowsHookEx         = user32.NewProc("SetWindowsHookExW")
	procCallNextHookEx           = user32.NewProc("CallNextHookEx")
	procUnhookWindowsHookEx      = user32.NewProc("UnhookWindowsHookEx")
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procGetCurrentProcessId      = kernel32.NewProc("GetCurrentProcessId")
	procGetAsyncKeyState         = user32.NewProc("GetAsyncKeyState")
	procKeybdEvent               = user32.NewProc("keybd_event")
)

const (
	whKeyboardLL = 13
	wmKeyDown    = 0x0100
	wmKeyUp      = 0x0101
	wmSysKeyDown = 0x0104
	wmSysKeyUp   = 0x0105
	vkSnapshot   = 0x2C
	vkShift      = 0x10
	vkControl    = 0x11
	vkMenu       = 0x12 // Alt
	llkhfAltDown = 0x20
)

type kbdLLHookStruct struct {
	VkCode      uint32
	ScanCode    uint32
	Flags       uint32
	Time        uint32
	DwExtraInfo uintptr
}

var (
	printScreenHook uintptr
	printScreenOnce sync.Once
	printScreenProc = syscall.NewCallback(printScreenHookProc)
)

// startPrintScreenBridge installs a low-level keyboard hook so bare PrtScn
// opens Snipping Tool while Cyrex is focused (WebView2 swallows it otherwise).
// Alt/Ctrl/Shift+PrtSc are left alone for normal Windows behavior.
func startPrintScreenBridge() {
	printScreenOnce.Do(func() {
		hMod, _, _ := kernel32.NewProc("GetModuleHandleW").Call(0)
		printScreenHook, _, _ = procSetWindowsHookEx.Call(
			uintptr(whKeyboardLL),
			printScreenProc,
			hMod,
			0,
		)
	})
}

func stopPrintScreenBridge() {
	if printScreenHook != 0 {
		procUnhookWindowsHookEx.Call(printScreenHook)
		printScreenHook = 0
	}
}

func keyDown(vk uint32) bool {
	state, _, _ := procGetAsyncKeyState.Call(uintptr(vk))
	return state&0x8000 != 0
}

func printScreenHasModifier(info *kbdLLHookStruct) bool {
	if info.Flags&llkhfAltDown != 0 {
		return true
	}
	return keyDown(vkShift) || keyDown(vkControl) || keyDown(vkMenu)
}

func printScreenHookProc(nCode int, wParam uintptr, lParam uintptr) uintptr {
	if nCode >= 0 {
		switch wParam {
		case wmKeyDown, wmKeyUp, wmSysKeyDown, wmSysKeyUp:
			info := (*kbdLLHookStruct)(unsafe.Pointer(lParam))
			if info.VkCode == vkSnapshot && ourWindowIsForeground() {
				// Alt+PrtSc (window shot), Ctrl/Shift combos — do not open snip.
				if printScreenHasModifier(info) {
					break
				}
				// Prefer key-up: classic PrintScreen is often delivered as KEY_UP only.
				if wParam == wmKeyUp || wParam == wmSysKeyUp {
					go launchScreenClip()
				}
				// Swallow bare PrtSc so WebView2 does not eat it without opening snip.
				return 1
			}
		}
	}
	ret, _, _ := procCallNextHookEx.Call(printScreenHook, uintptr(nCode), wParam, lParam)
	return ret
}

func ourWindowIsForeground() bool {
	hwnd, _, _ := procGetForegroundWindow.Call()
	if hwnd == 0 {
		return false
	}
	var pid uint32
	procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	self, _, _ := procGetCurrentProcessId.Call()
	return pid == uint32(self)
}

// launchScreenClip opens the Windows Snipping Tool overlay (same as Win+Shift+S).
func launchScreenClip() {
	uri, err := syscall.UTF16PtrFromString("ms-screenclip:")
	if err != nil {
		return
	}
	procShellExecuteW.Call(
		0,
		0,
		uintptr(unsafe.Pointer(uri)),
		0,
		0,
		1, // SW_SHOWNORMAL
	)
}
