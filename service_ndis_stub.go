//go:build !windows

package main

type StartNdisOptions struct {
}

func (s *Service) StartNDIS(options *StartNdisOptions) error {
	return nil
}

func (s *Service) StopNDIS() error {
	return nil
}

func (s *Service) AddProcess(process string, tcp, udp bool) error {
	return nil
}

func (s *Service) RemoveProcess(process string, tcp, udp bool) error {
	return nil
}

func (s *Service) HasProcess(process string, tcp, udp bool) (bool, bool, error) {
	return false, false, nil
}

func (s *Service) IsNDISRunning() (running bool) {
	running = false
	return
}

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