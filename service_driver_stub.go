//go:build !windows

package main

// InstallDriver installs the driver using netcfg.exe.
func (s *Service) InstallDriver() error {
	return nil
}

// UninstallDriver uninstalls the driver using netcfg.exe.
func (s *Service) UninstallDriver() error {
	return nil
}

// extractDriverFiles extracts the embedded driver files to the specified directory.
func (s *Service) extractDriverFiles(destDir string) error {
	return nil
}