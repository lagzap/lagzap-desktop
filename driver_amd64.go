//go:build windows && amd64

package main

import "embed"

//go:embed all:build/windows/driver/x64
var driverFS embed.FS