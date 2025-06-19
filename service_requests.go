package main

func (s *Service) GetRegions() error {
	return s.coordinator.GetRegions()
}

func (s *Service) GetTitles() error {
	return s.coordinator.GetTitles()
}

func (s *Service) GetNodes() error {
	return s.coordinator.GetNodes()
}
