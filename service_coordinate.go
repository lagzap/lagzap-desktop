package main

import (
	"fmt"

	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/common/device"
	"github.com/lagzap/lagzap/log"
	E "github.com/lagzap/zap/common/exceptions"
	D "github.com/lagzap/zap/data"
)

func (s *Service) SetAccessToken(token string) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetToken(token)
}

func (s *Service) SetSyncTransportMode(mode adapter.SyncTransportMode) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetSyncTransportMode(mode)
}

func (s *Service) SetHTTPPolling(enabled bool) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetHTTPPolling(enabled)
}

func (s *Service) SetLogLevel(logLevel string) {
	if s.coordinator == nil || s.logFactory == nil {
		return
	}
	level, err := log.ParseLevel(logLevel)
	if err != nil {
		return
	}
	s.logFactory.SetLevel(level)
}

func (s *Service) Connect() error {
	if s.coordinator == nil {
		return E.New("coordinator_not_ready")
	}
	return s.coordinator.Connect()
}

func (s *Service) Disconnect() {
	if s.coordinator == nil {
		return
	}
	s.coordinator.Disconnect()
}

// DisconnectTitle ends every open connection of a title (Connections page).
func (s *Service) DisconnectTitle(id string) {
	if s.coordinator == nil || id == "" {
		return
	}
	s.coordinator.CloseByTitle(id)
}

// DisconnectProfile ends every open connection of one profile.
func (s *Service) DisconnectProfile(id string) {
	if s.coordinator == nil || id == "" {
		return
	}
	s.coordinator.CloseByProfile(id)
}

func (s *Service) Status() adapter.ConnectionStatus {
	if s.coordinator == nil {
		return adapter.StatusDisconnected
	}
	return s.coordinator.Status()
}

func (s *Service) DeviceHash() string {
	return device.DeviceHash()
}

func (s *Service) Credentials() D.CredentialsPayload {
	return *s.coordinator.GetCredentials()
}

// PlanLimits is what the subscriber's plan allows (zero: no limit).
func (s *Service) PlanLimits() adapter.PlanLimits {
	if !s.IsReady() {
		return adapter.PlanLimits{}
	}
	return s.coordinator.GetPlanLimits()
}

func (s *Service) SyncData() error {
	if !s.IsReady() {
		return E.New("coordinator_not_ready")
	}
	return s.coordinator.SyncData(false)
}

func (s *Service) GetRegions() map[string]*D.Region {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetRegions()
}

func (s *Service) GetTitles() map[string]*D.Title {
	if !s.IsReady() {
		return nil
	}
	if plan, ok := s.coordinator.(adapter.PlanAccessProvider); ok {
		return plan.VisibleTitles()
	}
	return s.coordinator.GetTitles()
}

func (s *Service) GetProfiles() map[string]*D.Profile {
	if !s.IsReady() {
		return nil
	}
	if plan, ok := s.coordinator.(adapter.PlanAccessProvider); ok {
		return plan.VisibleProfiles()
	}
	return s.coordinator.GetProfiles()
}

func (s *Service) GetTitleStates() map[string]*D.TitleState {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetTitleStates()
}

func (s *Service) GetProfileStates() map[string]*D.ProfileState {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetProfileStates()
}

func (s *Service) GetClientInfo() *D.ClientInfo {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetClientInfo()
}

func (s *Service) GetNodes() map[string]*D.Node {
	if !s.IsReady() {
		return nil
	}
	if plan, ok := s.coordinator.(adapter.PlanAccessProvider); ok {
		return plan.VisibleNodes()
	}
	return s.coordinator.GetNodes()
}

// GetAccessOffer is the beta or trial on offer (nil: none).
func (s *Service) GetAccessOffer() *adapter.AccessOffer {
	if provider, ok := s.coordinator.(adapter.AccessOfferProvider); ok && s.IsReady() {
		return provider.GetAccessOffer()
	}
	return nil
}

// CheckAccessOffer refetches the account and returns the offer; polled while
// the Discord login is open in the browser.
func (s *Service) CheckAccessOffer() *adapter.AccessOffer {
	if provider, ok := s.coordinator.(adapter.AccessOfferProvider); ok && s.IsReady() {
		return provider.CheckAccessOffer()
	}
	return nil
}

// StartDiscordTrial returns the Discord login that grants the offer, to open
// in the system browser as it is, or the reason it was refused.
func (s *Service) StartDiscordTrial() adapter.DiscordTrialStart {
	if provider, ok := s.coordinator.(adapter.AccessOfferProvider); ok && s.IsReady() {
		return provider.StartDiscordTrial()
	}
	return adapter.DiscordTrialStart{Code: adapter.AccessStartUnreachable}
}

// GetRouteLevels is the plan's route level and the biggest gain a higher
// level measured, for the overview and the profile page.
func (s *Service) GetRouteLevels() *adapter.RouteLevel {
	if !s.IsReady() {
		return nil
	}
	if reporter, ok := s.coordinator.(adapter.RouteLevelReporter); ok {
		levels := reporter.GetRouteLevels()
		return &levels
	}
	return nil
}

// GetPlanAccess is what the user's plan makes locked or hidden, and its
// limits; Strict false means the server sends no plan data yet.
func (s *Service) GetPlanAccess() *adapter.PlanAccess {
	if !s.IsReady() {
		return nil
	}
	if plan, ok := s.coordinator.(adapter.PlanAccessProvider); ok {
		access := plan.GetPlanAccess()
		return &access
	}
	return nil
}

func (s *Service) VisitTitle(titleId string) {
	if !s.IsReady() {
		return
	}
	s.coordinator.VisitTitle(titleId)
}

func (s *Service) SaveTitleState(titleState *D.TitleState) error {
	if !s.IsReady() {
		return E.New("coordinator_not_ready")
	}
	if titleState != nil && titleState.Active && !s.coordinator.CanActivateTitle(titleState.TitleId) {
		return E.New("active_title_limit")
	}
	err := s.coordinator.SaveTitleState(titleState)
	if err != nil {
		return E.Cause(err, "could not save title state in cloud")
	}
	if err := s.coordinator.ApplyTitleState(titleState); err != nil {
		return E.Cause(err, "could not apply title state in cloud")
	}
	return nil
}

func (s *Service) SaveProfileState(profileState *D.ProfileState) error {
	if !s.IsReady() {
		return E.New("coordinator_not_ready")
	}
	if err := s.coordinator.SaveProfileState(profileState); err != nil {
		return E.Cause(err, "could not save title state in cloud")
	}
	return s.coordinator.ApplyProfileState(profileState)
}

func (s *Service) StartOptimizing() {
	if !s.IsReady() {
		return
	}
	s.coordinator.StartOptimizing(true)
}

func (s *Service) GetRoutes() map[string]*D.RelayRoute {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetRelayRoutes()
}

func (s *Service) GetRoutes2() []*D.Route {
	if !s.IsReady() {
		return nil
	}
	rr, _ := s.coordinator.GetRoutes()
	return rr
}

func (s *Service) GetOptimizeProgress() *D.Optimize {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetOptimize()
}

func (s *Service) GetIfaceEntryRTTs() map[string]float32 {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.SnapshotIfaceEntryRTTs()
}

func (s *Service) TestSpecificNode(nodeId string) (map[string]*D.RelayRoute, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	return s.coordinator.OptimizeSpecificNode(nodeId)
}

func (s *Service) ListPathPings(refresh bool) ([]adapter.PathPingRow, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	return s.coordinator.ListPathPings(refresh)
}

func (s *Service) ProbePath(kind, fromID, toID string) (adapter.PathPingRow, error) {
	if !s.IsReady() {
		return adapter.PathPingRow{}, E.New("coordinator_not_ready")
	}
	return s.coordinator.ProbePath(kind, fromID, toID)
}

// ProbeNodeRoutes pings the given relay paths immediately and returns updated
// routes with live latency (used by Estimated Ping on the route diagram).
// iface binds the probe to that NIC when set.
func (s *Service) ProbeNodeRoutes(routes []*D.NodeRoute, iface string) []*D.NodeRoute {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.ProbeNodeRoutes(routes, iface)
}

// ForceProbeRelay triggers an immediate probe of watched live sessions for a relay.
func (s *Service) ForceProbeRelay(nodeID string) {
	if !s.IsReady() {
		return
	}
	s.coordinator.ForceProbeRelay(nodeID)
}

func (s *Service) ClearDNSCache() {
	s.coordinator.ClearDNSCache()
}

func (s *Service) GetLatency() *D.Latency {
	return s.coordinator.GetLatency()
}

func (s *Service) GetClientSettings() *D.ClientSettings {
	if s.coordinator == nil {
		return nil
	}
	return s.coordinator.GetClientSettings()
}

func (s *Service) SetInternetPingTarget(target string) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetInternetPingTarget(target)
}

func (s *Service) GetInternetPingTarget() string {
	if s.coordinator == nil {
		return "bestPing"
	}
	return s.coordinator.InternetPingTargetID()
}

func (s *Service) SetRoutingSettings(routeAccuracy int, routeProtocol int, routeIp int, realtimeOptimization bool, proxyDNSRequests bool) {
	s.proxyDNSRequests = proxyDNSRequests

	// Apply when the running service uses another value (or none yet), not
	// only on a change here: the first sync after start sends the same value
	// the service read from its settings.
	if !s.proxyDNSApplied || s.proxyDNSAppliedValue != proxyDNSRequests {
		if err := s.applyProxyDNSConfig(); err != nil {
			fmt.Printf("proxy dns config update: %v\n", err)
		}
	}

	if s.coordinator == nil {
		return
	}
	accuracy := D.OptimizeAccuracy(routeAccuracy)
	protocol := D.OptimizeProtocol(routeProtocol)
	ip := D.OptimizeIP(routeIp)
	s.coordinator.SetClientSettings(&D.ClientSettings{
		RouteAccuracy:        &accuracy,
		RouteProtocol:        &protocol,
		RouteIp:              &ip,
		RealtimeOptimization: &realtimeOptimization,
		ProxyDnsRequests:     &proxyDNSRequests,
	})
}

// SetGamingPriority turns on marking Gaming Traffic profiles' legs as
// real-time traffic, for routers and networks that prioritize it.
func (s *Service) SetGamingPriority(enabled bool) {
	s.gamingPriority = enabled
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetGamingPriority(enabled)
}

// SetLoadBalanceWeights sets the user's load balancing weights (adapter ->
// 1..10; left out or 0 = automatic) for High traffic profiles.
func (s *Service) SetLoadBalanceWeights(weights map[string]uint32) {
	s.loadBalanceWeights = weights
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetLoadBalanceWeights(weights)
}

// SetLoadBalancePool sets the adapters flagged Load balance on the Multi
// Internet page (empty = every adapter); High traffic profiles use them.
func (s *Service) SetLoadBalancePool(names []string) {
	s.loadBalancePool = names
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetLoadBalancePool(names)
}

// SetMeteredInterfaces marks adapters as metered (mobile data, capped
// plans): updates and downloads are never load balanced over them.
func (s *Service) SetMeteredInterfaces(names []string) {
	s.meteredInterfaces = names
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetMeteredInterfaces(names)
}

// GetLoadBalanceShares reports each internet's load balancing weight and its
// share of new connections.
func (s *Service) GetLoadBalanceShares(names []string) []adapter.LoadBalanceShare {
	if s.coordinator == nil || len(names) == 0 {
		return nil
	}
	return s.coordinator.LoadBalanceShares(names)
}

func (s *Service) GetProxyDNSRequests() bool {
	return s.proxyDNSRequests
}

func (s *Service) SetClientSettings(settings *D.ClientSettings) {
	if s.coordinator == nil || settings == nil {
		return
	}
	s.coordinator.SetClientSettings(settings)
	current := s.coordinator.GetClientSettings()
	if current == nil {
		return
	}
	s.applyStartupSettings(current)
}
