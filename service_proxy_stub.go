//go:build !windows

package main

func (s *Service) StartProxy() error {
	return nil
}

func (s *Service) StopProxy() error {
	return nil
}

func (s *Service) IsProxyRunning() (running bool) {
	running = false
	return
}
