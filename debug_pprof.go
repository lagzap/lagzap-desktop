package main

import (
	"net"
	"net/http"
	"net/http/pprof"
	"os"
)

// startDebugPprof serves pprof on LAGZAP_PPROF (loopback only, e.g.
// 127.0.0.1:6060) so a silent freeze can be dumped live from
// /debug/pprof/goroutine?debug=2. Off unless the variable is set.
func startDebugPprof() {
	addr := os.Getenv("LAGZAP_PPROF")
	if addr == "" {
		return
	}
	host, _, err := net.SplitHostPort(addr)
	if ip := net.ParseIP(host); err != nil || ip == nil || !ip.IsLoopback() {
		return
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	go func() { _ = http.ListenAndServe(addr, mux) }()
}
