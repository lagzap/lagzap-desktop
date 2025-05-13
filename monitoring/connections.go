package monitoring

import (
	"net"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/zap/common"
	"github.com/lagzap/zap/common/atomic"
	"github.com/lagzap/zap/common/bufio"
	"github.com/lagzap/zap/common/json"
	N "github.com/lagzap/zap/common/network"
)

type ConnectionMetadata struct {
	id                uuid.UUID
	metadata          adapter.InboundContext
	createdAt         time.Time
	closedAt          time.Time
	upload            *atomic.Int64
	download          *atomic.Int64
	uplinkSpeed       *atomic.Int64
	downlinkSpeed     *atomic.Int64
	lastSpeedCalc     time.Time
	chain             []string
	rule              adapter.Rule
	outbound          string
	outboundType      string
	geoipCode         string
	uploadBuffer      *atomic.Int64
	downloadBuffer    *atomic.Int64
	speedUpdateTicker *time.Ticker
}

func (t *ConnectionMetadata) UpdateSpeeds() {
	now := time.Now()
	duration := now.Sub(t.lastSpeedCalc).Seconds()
	if duration > 0 {
		uplinkBytes := t.uploadBuffer.Swap(0)
		downlinkBytes := t.downloadBuffer.Swap(0)

		uplinkSpeed := int64(float64(uplinkBytes) / duration)
		downlinkSpeed := int64(float64(downlinkBytes) / duration)

		t.uplinkSpeed.Store(uplinkSpeed)
		t.downlinkSpeed.Store(downlinkSpeed)

		t.lastSpeedCalc = now
	}
}

func (t *ConnectionMetadata) StartSpeedTracker() {
	t.speedUpdateTicker = time.NewTicker(time.Second)
	go func() {
		for range t.speedUpdateTicker.C {
			t.UpdateSpeeds()
		}
	}()
}

func (t *ConnectionMetadata) StopSpeedTracker() {
	if t.speedUpdateTicker != nil {
		t.speedUpdateTicker.Stop()
	}
}

func (t ConnectionMetadata) MarshalJSON() ([]byte, error) {
	var domain string
	if t.metadata.Domain != "" {
		domain = t.metadata.Domain
	} else {
		domain = t.metadata.Destination.Fqdn
	}

	rule := "final"
	ruleAction := "direct"
	if t.rule != nil {
		rule = t.rule.String()
		ruleAction = t.rule.Action().Type()
	}

	process := ""
	if t.metadata.ProcessInfo != nil {
		process = t.metadata.ProcessInfo.ProcessPath
	}

	return json.Marshal(map[string]any{
		"id":            t.id,
		"network":       t.metadata.Network,
		"source":        t.metadata.Source.String(),
		"destination":   t.metadata.Destination.String(),
		"host":          domain,
		"process":       process,
		"uplink":        t.upload.Load(),
		"downlink":      t.download.Load(),
		"uplinkSpeed":   t.uplinkSpeed.Load(),
		"downlinkSpeed": t.downlinkSpeed.Load(),
		"speed":         t.uplinkSpeed.Load() + t.downlinkSpeed.Load(),
		"latency":       80,
		"start":         t.createdAt.Unix(),
		"chains":        t.chain,
		"rule":          rule,
		"geoipCode":     t.geoipCode,
		"action":        ruleAction,
	})
}

type Connection interface {
	Connection() ConnectionMetadata
	Close() error
}

type TCPConn struct {
	N.ExtendedConn
	metadata ConnectionMetadata
	manager  *Monitoring
}

func (tt *TCPConn) Connection() ConnectionMetadata {
	return tt.metadata
}

func (tt *TCPConn) Close() error {
	tt.metadata.StopSpeedTracker()
	tt.manager.Leave(tt)
	return tt.ExtendedConn.Close()
}

func (tt *TCPConn) Upstream() any {
	return tt.ExtendedConn
}

func (tt *TCPConn) ReaderReplaceable() bool {
	return true
}

func (tt *TCPConn) WriterReplaceable() bool {
	return true
}

func NewTCPTracker(conn net.Conn, manager *Monitoring, metadata adapter.InboundContext, outboundManager adapter.OutboundManager, matchRule adapter.Rule, matchOutbound adapter.Outbound) *TCPConn {
	id, _ := uuid.NewV4()
	var (
		chain        []string
		next         string
		outbound     string
		outboundType string
		geoipCode    string
	)
	if matchOutbound != nil {
		next = matchOutbound.Tag()
	} else {
		next = outboundManager.Default().Tag()
	}
	for {
		detour, loaded := outboundManager.Outbound(next)
		if !loaded {
			break
		}
		chain = append(chain, next)
		outbound = detour.Tag()
		outboundType = detour.Type()
		group, isGroup := detour.(adapter.OutboundGroup)
		if !isGroup {
			break
		}
		next = group.Now()
	}
	destination := metadata.Destination.Addr
	if destination.IsValid() {
		geoReader := manager.router.GeoIPReader()
		geoipCode = geoReader.Lookup(destination)
	}
	upload := new(atomic.Int64)
	download := new(atomic.Int64)
	uplinkSpeed := new(atomic.Int64)
	downlinkSpeed := new(atomic.Int64)
	uploadBuffer := new(atomic.Int64)
	downloadBuffer := new(atomic.Int64)

	now := time.Now()
	connMetadata := ConnectionMetadata{
		id:             id,
		metadata:       metadata,
		createdAt:      now,
		upload:         upload,
		download:       download,
		uplinkSpeed:    uplinkSpeed,
		downlinkSpeed:  downlinkSpeed,
		lastSpeedCalc:  now,
		chain:          common.Reverse(chain),
		rule:           matchRule,
		outbound:       outbound,
		outboundType:   outboundType,
		geoipCode:      geoipCode,
		uploadBuffer:   uploadBuffer,
		downloadBuffer: downloadBuffer,
	}

	connMetadata.StartSpeedTracker()

	tracker := &TCPConn{
		ExtendedConn: bufio.NewCounterConn(conn, []N.CountFunc{func(n int64) {
			upload.Add(n)
			uploadBuffer.Add(n)
			manager.PushUploaded(n)
		}}, []N.CountFunc{func(n int64) {
			download.Add(n)
			downloadBuffer.Add(n)
			manager.PushDownloaded(n)
		}}),
		metadata: connMetadata,
		manager:  manager,
	}
	manager.Join(tracker)
	return tracker
}

type UDPConn struct {
	N.PacketConn `json:"-"`
	metadata     ConnectionMetadata
	manager      *Monitoring
}

func (ut *UDPConn) Connection() ConnectionMetadata {
	return ut.metadata
}

func (ut *UDPConn) Close() error {
	ut.metadata.StopSpeedTracker()
	ut.manager.Leave(ut)
	return ut.PacketConn.Close()
}

func (ut *UDPConn) Upstream() any {
	return ut.PacketConn
}

func (ut *UDPConn) ReaderReplaceable() bool {
	return true
}

func (ut *UDPConn) WriterReplaceable() bool {
	return true
}

func NewUDPTracker(conn N.PacketConn, manager *Monitoring, metadata adapter.InboundContext, outboundManager adapter.OutboundManager, matchRule adapter.Rule, matchOutbound adapter.Outbound) *UDPConn {
	id, _ := uuid.NewV4()
	var (
		chain        []string
		next         string
		outbound     string
		outboundType string
		geoipCode    string
	)
	if matchOutbound != nil {
		next = matchOutbound.Tag()
	} else {
		next = outboundManager.Default().Tag()
	}
	for {
		detour, loaded := outboundManager.Outbound(next)
		if !loaded {
			break
		}
		chain = append(chain, next)
		outbound = detour.Tag()
		outboundType = detour.Type()
		group, isGroup := detour.(adapter.OutboundGroup)
		if !isGroup {
			break
		}
		next = group.Now()
	}
	destination := metadata.Destination.Addr
	if destination.IsValid() {
		geoReader := manager.router.GeoIPReader()
		geoipCode = geoReader.Lookup(destination)
	}
	upload := new(atomic.Int64)
	download := new(atomic.Int64)
	uplinkSpeed := new(atomic.Int64)
	downlinkSpeed := new(atomic.Int64)
	uploadBuffer := new(atomic.Int64)
	downloadBuffer := new(atomic.Int64)

	now := time.Now()
	connMetadata := ConnectionMetadata{
		id:             id,
		metadata:       metadata,
		createdAt:      now,
		upload:         upload,
		download:       download,
		uplinkSpeed:    uplinkSpeed,
		downlinkSpeed:  downlinkSpeed,
		lastSpeedCalc:  now,
		chain:          common.Reverse(chain),
		rule:           matchRule,
		outbound:       outbound,
		outboundType:   outboundType,
		geoipCode:      geoipCode,
		uploadBuffer:   uploadBuffer,
		downloadBuffer: downloadBuffer,
	}

	connMetadata.StartSpeedTracker()

	trackerConn := &UDPConn{
		PacketConn: bufio.NewCounterPacketConn(conn, []N.CountFunc{func(n int64) {
			upload.Add(n)
			uploadBuffer.Add(n)
			manager.PushUploaded(n)
		}}, []N.CountFunc{func(n int64) {
			download.Add(n)
			downloadBuffer.Add(n)
			manager.PushDownloaded(n)
		}}),
		metadata: connMetadata,
		manager:  manager,
	}
	manager.Join(trackerConn)
	return trackerConn
}
