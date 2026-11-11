package main

import "sync"

// recentLogsMax matches the log page's limit (MAX_LOGS in stores/monitoring.ts).
const recentLogsMax = 1000

// recentLogs keeps the latest log lines so a window opened later (Admin
// Tools is its own window) shows what happened before it opened, not only
// what comes after.
var recentLogs struct {
	mu    sync.Mutex
	lines []Log
	next  int
	full  bool
}

func rememberLog(entry Log) {
	recentLogs.mu.Lock()
	defer recentLogs.mu.Unlock()
	if recentLogs.lines == nil {
		recentLogs.lines = make([]Log, recentLogsMax)
	}
	recentLogs.lines[recentLogs.next] = entry
	recentLogs.next = (recentLogs.next + 1) % recentLogsMax
	if recentLogs.next == 0 {
		recentLogs.full = true
	}
}

// GetRecentLogs returns the remembered log lines, oldest first.
func (s *Service) GetRecentLogs() []Log {
	recentLogs.mu.Lock()
	defer recentLogs.mu.Unlock()
	if !recentLogs.full {
		return append([]Log{}, recentLogs.lines[:recentLogs.next]...)
	}
	out := make([]Log, 0, recentLogsMax)
	out = append(out, recentLogs.lines[recentLogs.next:]...)
	return append(out, recentLogs.lines[:recentLogs.next]...)
}
