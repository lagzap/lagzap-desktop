package main

import (
	"strings"
	"sync"

	"github.com/lagzap/lagzap/adapter"
)

// AppInfo is how the Bandwidth Control page shows an app.
type AppInfo struct {
	// Name is the exe's file description ("" when it has none).
	Name string `json:"name"`
	// Icon is a PNG data URL ("" when the exe has none).
	Icon string `json:"icon"`
}

var appInfoCache sync.Map // lower-case path -> AppInfo

// GetAppInfo reads an exe's display name and icon (cached per path).
func (s *Service) GetAppInfo(path string) AppInfo {
	if path == "" || strings.HasPrefix(path, ":") {
		return AppInfo{}
	}
	key := strings.ToLower(path)
	if cached, ok := appInfoCache.Load(key); ok {
		return cached.(AppInfo)
	}
	info := readAppInfo(path)
	appInfoCache.Store(key, info)
	return info
}

// SetAppTrafficWatch starts (watch) or stops the "app-traffic" stream for
// the Bandwidth Control page. Starting returns the snapshot with each
// app's last minute of speed.
func (s *Service) SetAppTrafficWatch(watcher string, watch bool) *adapter.AppTrafficSnapshot {
	if s.coordinator == nil {
		return nil
	}
	return s.coordinator.SetAppTrafficWatch(watcher, watch)
}

// SetAppLimits replaces the per-app speed caps. The client keeps them in
// IndexedDB and sends them again whenever the service starts.
func (s *Service) SetAppLimits(rules []adapter.AppLimitRule) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetAppLimits(rules)
}

// Gaming: a game profile has an active connection, or had one in the last
// minute ("only while gaming" caps apply). Changes come on "gaming-state".
func (s *Service) Gaming() bool {
	if s.coordinator == nil {
		return false
	}
	return s.coordinator.Gaming()
}
