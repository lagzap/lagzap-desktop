//go:build !windows

package main

func (s *Service) IsDriverInstalled() bool {
	return true
}

func (s *Service) InstallDriver() error {
	return nil
}

func (s *Service) UninstallDriver() error {
	return nil
}

func (s *Service) extractDriverFiles(destDir string) error {
	return nil
}
