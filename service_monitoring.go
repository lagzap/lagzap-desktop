package main

import (
	"encoding/json"
	"time"

	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/log"
	D "github.com/lagzap/zap/data"
)

type Log struct {
	Time    time.Time `json:"time"`
	Type    string    `json:"type"`
	Payload string    `json:"payload"`
}

func (s *Service) startLogging() {
	subscription, done, err := s.logFactory.Subscribe()
	if err != nil {
		return
	}
	defer s.logFactory.UnSubscribe(subscription)

	var logEntry log.Entry
	for {
		select {
		case <-done:
			return
		case logEntry = <-subscription:
		}
		s.app.Event.Emit("log", Log{
			Time:    time.Now(),
			Type:    log.FormatLevel(logEntry.Level),
			Payload: logEntry.Message,
		})
	}
}

func (s *Service) startMonitoring() {
	if s.coordinator == nil {
		return
	}
	emitSnapshot := func() {
		if s.coordinator == nil || s.app == nil {
			return
		}
		connections := s.coordinator.Connections()
		if connections == nil {
			connections = []*D.ConnectionStats{}
		}
		// Round-trip through encoding/json so the webview always gets plain
		// objects (protobuf message state can confuse Wails serializers).
		s.app.Event.Emit("connections", s.withRelayIssues(jsonClone(connections)))
		s.app.Event.Emit("routes", jsonClone(s.coordinator.GetRouteMonitoringData()))
	}

	emitSnapshot()

	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	var last time.Time
	for {
		select {
		case <-s.ctx.Done():
			return
		case now := <-tick.C:
			if s.lagzap == nil || s.coordinator == nil {
				continue
			}
			// Cloning every connection each second is the heaviest stream.
			if uiBackground.Load() && now.Sub(last) < uiBackgroundEvery {
				continue
			}
			last = now
			emitSnapshot()
		}
	}
}

// GetConnections returns the live tracked connection snapshot for UI polling.
func (s *Service) GetConnections() any {
	if s.coordinator == nil {
		return []any{}
	}
	connections := s.coordinator.Connections()
	if connections == nil {
		return []any{}
	}
	cloned := jsonClone(connections)
	if cloned == nil {
		return []any{}
	}
	return s.withRelayIssues(cloned)
}

// withRelayIssues adds "relay_issue" ({code, detail}) to cloned connection
// rows that LagZap could not relay as configured, so the UI can warn why.
func (s *Service) withRelayIssues(cloned any) any {
	list, ok := cloned.([]any)
	if !ok || s.coordinator == nil {
		return cloned
	}
	issues := s.coordinator.ConnectionRelayIssues()
	if len(issues) == 0 {
		return cloned
	}
	for _, item := range list {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, _ := row["id"].(string)
		if issue, found := issues[id]; found {
			row["relay_issue"] = map[string]any{"code": issue.Code, "detail": issue.Detail}
		}
	}
	return cloned
}

// GetLatestRouteProbes returns the newest live-probe snapshot per watched relay.
func (s *Service) GetLatestRouteProbes() any {
	if s.coordinator == nil {
		return []any{}
	}
	probes := s.coordinator.GetLatestRouteProbes()
	if len(probes) == 0 {
		return []any{}
	}
	cloned := jsonClone(probes)
	if cloned == nil {
		return []any{}
	}
	return cloned
}

// WatchProfileChart streams "profile-chart" snapshots for one profile and
// returns the current one; an empty range stops the stream.
func (s *Service) WatchProfileChart(profileID, rangeKey, iface, connectionID string) *adapter.ProfileChart {
	if s.coordinator == nil {
		return nil
	}
	return s.coordinator.WatchProfileChart(profileID, rangeKey, iface, connectionID)
}

// FixProfileLag looks for fresh routes now and moves the profile's live
// sessions onto the best ones.
func (s *Service) FixProfileLag(profileID string) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.FixProfileLag(profileID)
}

// ProbeProfileRoutes probes the diagram routes on screen for a profile/NIC now.
func (s *Service) ProbeProfileRoutes(profileID, iface string) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.ProbeProfileRoutes(profileID, iface)
}

// SetOverviewRange selects the range streamed on the "overview" event and
// returns the current snapshot; an empty range stops the stream.
func (s *Service) SetOverviewRange(watcher, key string) *adapter.OverviewChart {
	if s.coordinator == nil {
		return nil
	}
	return s.coordinator.SetOverviewRange(watcher, key)
}

// SetNetworkMonitorRange selects the range streamed on "network-monitor" for
// the Monitoring page and returns the current snapshot; an empty range
// stops the stream.
func (s *Service) SetNetworkMonitorRange(watcher, key string) *adapter.NetworkMonitor {
	if s.coordinator == nil {
		return nil
	}
	return s.coordinator.SetNetworkMonitorRange(watcher, key)
}

// SetInterfaceMonitorRange streams one connection's monitoring page on
// "interface-monitor" and returns the current snapshot; an empty range stops it.
func (s *Service) SetInterfaceMonitorRange(watcher, iface, key, lang string) *adapter.InterfaceMonitorDetail {
	if s.coordinator == nil {
		return nil
	}
	return s.coordinator.SetInterfaceMonitorRange(watcher, iface, key, lang)
}

// SetLocationMonitor streams one LagZap location's page on "location-monitor";
// manual starts probing it by hand. An empty range stops the stream.
func (s *Service) SetLocationMonitor(watcher, key, rangeKey, lang string, manual bool) *adapter.LocationMonitor {
	if s.coordinator == nil {
		return nil
	}
	return s.coordinator.SetLocationMonitor(watcher, key, rangeKey, lang, manual)
}

// GetServerDirectory lists LagZap regions and cities with the ping from the
// chosen connection ("" = best connection), for the Monitoring page.
func (s *Service) GetServerDirectory(iface, lang string) *adapter.ServerDirectory {
	if s.coordinator == nil {
		return nil
	}
	return s.coordinator.GetServerDirectory(iface, lang)
}

// GetServerCityDetails explains one city: ping from each connection, routes
// and servers.
func (s *Service) GetServerCityDetails(key, lang string) *adapter.ServerCityDetails {
	if s.coordinator == nil {
		return nil
	}
	return s.coordinator.GetServerCityDetails(key, lang)
}

func jsonClone(v any) any {
	raw, err := json.Marshal(v)
	if err != nil {
		return v
	}
	if len(raw) == 0 || string(raw) == "null" {
		return v
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return v
	}
	return out
}
