//go:build windows && 386

package main

import "embed"

//go:embed all:build/windows/driver/x86
var driverFS embed.FS
