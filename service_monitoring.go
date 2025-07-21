package main

func (s *Service) startMonitoring() {
	// s.app.EmitEvent("connections", s.monitoring.Connections())
	// s.app.EmitEvent("closed-connections", s.monitoring.ClosedConnections())

	// tick := time.NewTicker(time.Second)
	// defer tick.Stop()
	// for {
	// 	select {
	// 	case <-s.ctx.Done():
	// 		return
	// 	case <-tick.C:
	// 		if s.lagzap == nil {
	// 			return
	// 		}
	// 		s.app.EmitEvent("connections", s.monitoring.Connections())
	// 		s.app.EmitEvent("closed-connections", s.monitoring.ClosedConnections())
	// 	}
	// }
}
