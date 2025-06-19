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
