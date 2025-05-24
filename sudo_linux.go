//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
)

func runAsAdministrator() {
	// Implementation for running as administrator on Linux
	args := append([]string{os.Args[0]}, os.Args[1:]...)
	cmd := exec.Command("sudo", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	if err != nil {
		fmt.Println(err)
	}
}

func isAdminUser() bool {
	_, err := os.Open("/root")
	return err == nil
}
