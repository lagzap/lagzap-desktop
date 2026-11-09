//go:build windows

package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The Jump List is built through the shell's COM interfaces:
// ICustomDestinationList, with IShellLinkW entries in IObjectCollections.

var (
	modOle32             = windows.NewLazySystemDLL("ole32.dll")
	procCoCreateInstance = modOle32.NewProc("CoCreateInstance")

	clsidDestinationList            = windows.GUID{Data1: 0x77f10cf0, Data2: 0x3db5, Data3: 0x4966, Data4: [8]byte{0xb5, 0x20, 0xb7, 0xc5, 0x4f, 0xd3, 0x5e, 0xd6}}
	iidCustomDestinationList        = windows.GUID{Data1: 0x6332debf, Data2: 0x87b5, Data3: 0x4670, Data4: [8]byte{0x90, 0xc0, 0x5e, 0x57, 0xb4, 0x08, 0xa4, 0x9e}}
	clsidEnumerableObjectCollection = windows.GUID{Data1: 0x2d3468c1, Data2: 0x36a7, Data3: 0x43b6, Data4: [8]byte{0xac, 0x24, 0xd3, 0xf0, 0x2f, 0xd9, 0x60, 0x7a}}
	iidObjectCollection             = windows.GUID{Data1: 0x5632b1a4, Data2: 0xe38a, Data3: 0x400a, Data4: [8]byte{0x92, 0x8a, 0xd4, 0xcd, 0x63, 0x23, 0x02, 0x95}}
	iidObjectArray                  = windows.GUID{Data1: 0x92ca9dcd, Data2: 0x5622, Data3: 0x4bba, Data4: [8]byte{0xa8, 0x05, 0x5e, 0x9f, 0x54, 0x1b, 0xd8, 0xc9}}
	clsidShellLink                  = windows.GUID{Data1: 0x00021401, Data4: [8]byte{0xc0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidShellLinkW                   = windows.GUID{Data1: 0x000214f9, Data4: [8]byte{0xc0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidPropertyStore                = windows.GUID{Data1: 0x886d8eeb, Data2: 0x8cf2, Data3: 0x4446, Data4: [8]byte{0x8d, 0x02, 0xcd, 0xba, 0x1d, 0xbd, 0xcf, 0x99}}
	pkeyTitle                       = propertyKey{fmtid: windows.GUID{Data1: 0xf29f85e0, Data2: 0x4ff9, Data3: 0x1068, Data4: [8]byte{0xab, 0x91, 0x08, 0x00, 0x2b, 0x27, 0xb3, 0xd9}}, pid: 2}
)

// Method slots, after IUnknown's QueryInterface (0), AddRef, Release (2).
const (
	vtQueryInterface = 0
	vtRelease        = 2

	dlBeginList      = 4
	dlAppendCategory = 5
	dlAddUserTasks   = 7
	dlCommitList     = 8
	dlAbortList      = 11

	oaGetCount = 3
	oaGetAt    = 4
	ocAdd      = 5

	slSetDescription      = 7
	slSetWorkingDirectory = 9
	slGetArguments        = 10
	slSetArguments        = 11
	slSetIconLocation     = 17
	slSetPath             = 20

	psSetValue = 6
	psCommit   = 7

	clsctxInprocServer = 1
	vtLPWSTR           = 31
)

type propertyKey struct {
	fmtid windows.GUID
	pid   uint32
}

// propVariant is PROPVARIANT holding a string pointer.
type propVariant struct {
	vt      uint16
	_, _, _ uint16
	val     uintptr
	_       uintptr
}

type comObj struct{ p unsafe.Pointer }

func (c comObj) call(method int, args ...uintptr) error {
	vtbl := *(*unsafe.Pointer)(c.p)
	fn := *(*uintptr)(unsafe.Add(vtbl, uintptr(method)*unsafe.Sizeof(uintptr(0))))
	hr, _, _ := syscall.SyscallN(fn, append([]uintptr{uintptr(c.p)}, args...)...)
	if int32(hr) < 0 {
		return fmt.Errorf("HRESULT 0x%08x", uint32(hr))
	}
	return nil
}

func (c comObj) release() {
	if c.p != nil {
		_ = c.call(vtRelease)
	}
}

func (c comObj) query(iid *windows.GUID) (comObj, error) {
	var out unsafe.Pointer
	err := c.call(vtQueryInterface, uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&out)))
	return comObj{out}, err
}

func createCOM(clsid, iid *windows.GUID) (comObj, error) {
	var out unsafe.Pointer
	hr, _, _ := procCoCreateInstance.Call(uintptr(unsafe.Pointer(clsid)), 0, clsctxInprocServer, uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&out)))
	if int32(hr) < 0 {
		return comObj{}, fmt.Errorf("CoCreateInstance: HRESULT 0x%08x", uint32(hr))
	}
	return comObj{out}, nil
}

func utf16(s string) *uint16 {
	p, err := windows.UTF16PtrFromString(s)
	if err != nil {
		p, _ = windows.UTF16PtrFromString("")
	}
	return p
}

// applyJumpList replaces the Jump List. Entries the user removed from it stay
// out, as Windows asks.
func applyJumpList(exe string, categories []jumpCategory) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED); err == nil {
		defer windows.CoUninitialize()
	} else if !errors.Is(err, windows.Errno(0x80010106)) { // RPC_E_CHANGED_MODE: already initialized
		return fmt.Errorf("CoInitializeEx: %w", err)
	}

	list, err := createCOM(&clsidDestinationList, &iidCustomDestinationList)
	if err != nil {
		return err
	}
	defer list.release()
	var slots uint32
	var removed comObj
	if err := list.call(dlBeginList, uintptr(unsafe.Pointer(&slots)), uintptr(unsafe.Pointer(&iidObjectArray)), uintptr(unsafe.Pointer(&removed.p))); err != nil {
		return fmt.Errorf("BeginList: %w", err)
	}
	removedTargets := removedJumpTargets(removed)
	removed.release()

	committed := false
	defer func() {
		if !committed {
			_ = list.call(dlAbortList)
		}
	}()
	var fallback []jumpItem
	for _, category := range categories {
		items := keptJumpItems(category.Items, removedTargets)
		if len(items) == 0 {
			continue
		}
		collection, err := jumpCollection(exe, items)
		if err != nil {
			return err
		}
		name := utf16(category.Name)
		err = list.call(dlAppendCategory, uintptr(unsafe.Pointer(name)), uintptr(collection.p))
		runtime.KeepAlive(name)
		collection.release()
		if err != nil {
			// Custom sections are refused while "Show recently opened items"
			// is off in Windows settings; the general entries still go in as
			// tasks.
			if len(fallback) == 0 {
				fallback = items
			}
			continue
		}
	}
	if len(fallback) > 0 {
		collection, err := jumpCollection(exe, fallback)
		if err != nil {
			return err
		}
		err = list.call(dlAddUserTasks, uintptr(collection.p))
		collection.release()
		if err != nil {
			return fmt.Errorf("AddUserTasks: %w", err)
		}
	}
	if err := list.call(dlCommitList); err != nil {
		return fmt.Errorf("CommitList: %w", err)
	}
	committed = true
	return nil
}

func keptJumpItems(items []jumpItem, removed map[string]bool) []jumpItem {
	var out []jumpItem
	for _, item := range items {
		if !removed[jumpArgPrefix+item.Target] {
			out = append(out, item)
		}
	}
	return out
}

// jumpCollection returns an IObjectArray of shell links for items.
func jumpCollection(exe string, items []jumpItem) (comObj, error) {
	collection, err := createCOM(&clsidEnumerableObjectCollection, &iidObjectCollection)
	if err != nil {
		return comObj{}, err
	}
	defer collection.release()
	for _, item := range items {
		link, err := jumpLink(exe, item)
		if err != nil {
			return comObj{}, err
		}
		err = collection.call(ocAdd, uintptr(link.p))
		link.release()
		if err != nil {
			return comObj{}, fmt.Errorf("AddObject: %w", err)
		}
	}
	return collection.query(&iidObjectArray)
}

func jumpLink(exe string, item jumpItem) (comObj, error) {
	link, err := createCOM(&clsidShellLink, &iidShellLinkW)
	if err != nil {
		return comObj{}, err
	}
	path, args, dir, icon, title := utf16(exe), utf16(jumpArgPrefix+item.Target), utf16(filepath.Dir(exe)), utf16(item.Icon), utf16(item.Title)
	err = errors.Join(
		link.call(slSetPath, uintptr(unsafe.Pointer(path))),
		link.call(slSetArguments, uintptr(unsafe.Pointer(args))),
		link.call(slSetWorkingDirectory, uintptr(unsafe.Pointer(dir))),
		link.call(slSetIconLocation, uintptr(unsafe.Pointer(icon)), uintptr(item.IconIndex)),
		link.call(slSetDescription, uintptr(unsafe.Pointer(title))),
	)
	if err == nil {
		var store comObj
		if store, err = link.query(&iidPropertyStore); err == nil {
			value := propVariant{vt: vtLPWSTR, val: uintptr(unsafe.Pointer(title))}
			err = errors.Join(store.call(psSetValue, uintptr(unsafe.Pointer(&pkeyTitle)), uintptr(unsafe.Pointer(&value))), store.call(psCommit))
			store.release()
		}
	}
	runtime.KeepAlive(path)
	runtime.KeepAlive(args)
	runtime.KeepAlive(dir)
	runtime.KeepAlive(icon)
	runtime.KeepAlive(title)
	if err != nil {
		link.release()
		return comObj{}, fmt.Errorf("shell link %q: %w", item.Title, err)
	}
	return link, nil
}

// removedJumpTargets returns the arguments of the entries the user removed.
func removedJumpTargets(removed comObj) map[string]bool {
	out := map[string]bool{}
	if removed.p == nil {
		return out
	}
	var count uint32
	if removed.call(oaGetCount, uintptr(unsafe.Pointer(&count))) != nil {
		return out
	}
	for i := uint32(0); i < count; i++ {
		var link comObj
		if removed.call(oaGetAt, uintptr(i), uintptr(unsafe.Pointer(&iidShellLinkW)), uintptr(unsafe.Pointer(&link.p))) != nil {
			continue
		}
		buf := make([]uint16, 1024)
		if link.call(slGetArguments, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf))) == nil {
			out[windows.UTF16ToString(buf)] = true
		}
		link.release()
	}
	return out
}
