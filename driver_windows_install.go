//go:build windows

package main

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/windows"
)

func (s *Service) IsDriverInstalled() bool {
	devicePath, err := windows.UTF16PtrFromString("\\\\.\\LAGZAP")
	if err != nil {
		return false
	}

	fileHandle, err := windows.CreateFile(
		devicePath, // Device path
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		0,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(fileHandle)

	if fileHandle == windows.InvalidHandle {
		return false
	}
	_, err = windows.CreateEvent(nil, 0, 0, nil)
	return err == nil
}

// InstallDriver installs the driver using netcfg.exe.
func (s *Service) InstallDriver() error {
	tempDir, err := os.MkdirTemp("", "lagzap_driver")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	err = s.extractDriverFiles(tempDir)
	if err != nil {
		return fmt.Errorf("failed to extract driver files: %w", err)
	}

	infPath := filepath.Join(tempDir, "lagzap_lwf.inf")
	cmd := exec.Command("netcfg.exe", "-v", "-l", infPath, "-c", "s", "-i", "nt_lagzap")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to install driver: %w", err)
	}

	return nil
}

// UninstallDriver uninstalls the driver using netcfg.exe.
func (s *Service) UninstallDriver() error {
	if s.IsProxyRunning() {
		s.StopProxy()
	}
	if s.IsRunning() {
		s.StopService()
	}
	cmd := exec.Command("netcfg.exe", "-u", "nt_lagzap")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to uninstall driver: %w", err)
	}

	return nil
}

// extractDriverFiles extracts the embedded driver files to the specified directory.
func (s *Service) extractDriverFiles(destDir string) error {
	return fs.WalkDir(driverFS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}

		data, err := driverFS.ReadFile(path)
		if err != nil {
			return err
		}

		destPath := filepath.Join(destDir, filepath.Base(path))
		return os.WriteFile(destPath, data, 0o644)
	})
}
