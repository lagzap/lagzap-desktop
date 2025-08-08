//go:build windows

package main

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"github.com/lagzap/lagzap/option"
	E "github.com/lagzap/zap/common/exceptions"
	F "github.com/lagzap/zap/common/format"
)

func (s *Service) StartNDIS() error {
	if s.lagzap == nil {
		return E.New("service is not running")
	}

	return s.lagzap.Inbound().Create(
		s.ctx,
		s.lagzap.Router(),
		s.lagzap.Logger().NewLogger(F.ToString("[ndis] winpkfilter [in]")),
		"ndis",
		"ndis",
		&option.NDISInboundOptions{},
	)
}

func (s *Service) StopNDIS() error {
	if s.lagzap == nil {
		return E.New("ndis not found")
	}
	return s.lagzap.Inbound().Remove("ndis")
}

func (s *Service) IsNDISRunning() (running bool) {
	if s.lagzap == nil {
		running = false
	} else {
		_, running = s.lagzap.Inbound().Get("ndis")
	}
	return
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
	if s.IsNDISRunning() {
		s.StopNDIS()
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
	// Walk through the embedded files and write them to the destination directory
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
		return os.WriteFile(destPath, data, 0644)
	})
}