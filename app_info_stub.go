//go:build !windows

package main

func readAppInfo(string) AppInfo {
	return AppInfo{}
}
