//go:build windows && arm64

package main

import "embed"

//go:embed all:build/windows/driver/arm64
var driverFS embed.FS
