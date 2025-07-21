package coordinator

import (
	"context"
	"net"
	"regexp"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/common/compatible"
	"github.com/lagzap/zap/common/atomic"
	N "github.com/lagzap/zap/common/network"
	"github.com/lagzap/zap/common/x/list"
	"github.com/lagzap/zap/service"
)

type Monitoring struct {
	adapter.ConnectionTracker
	ctx      context.Context
	router   adapter.Router
	inbound  adapter.InboundManager
	outbound adapter.OutboundManager

	uploadTotal   atomic.Int64
	downloadTotal atomic.Int64

	connections             compatible.Map[uuid.UUID, Connection]
	closedConnectionsAccess sync.Mutex
	closedConnections       list.List[ConnectionMetadata]
	memory                  uint64
}

func NewMonitoring(ctx context.Context) *Monitoring {
	return &Monitoring{
		ctx:      ctx,
		router:   service.FromContext[adapter.Router](ctx),
		inbound:  service.FromContext[adapter.InboundManager](ctx),
		outbound: service.FromContext[adapter.OutboundManager](ctx),
	}
}

func (m *Monitoring) RoutedConnection(ctx context.Context, conn net.Conn, metadata adapter.InboundContext, matchedRule adapter.Rule, matchOutbound adapter.Outbound) net.Conn {
	return NewTCPTracker(conn, m, metadata, m.outbound, matchedRule, matchOutbound)
}

func (m *Monitoring) RoutedPacketConnection(ctx context.Context, conn N.PacketConn, metadata adapter.InboundContext, matchedRule adapter.Rule, matchOutbound adapter.Outbound) N.PacketConn {
	return NewUDPTracker(conn, m, metadata, m.outbound, matchedRule, matchOutbound)
}

func (m *Monitoring) Join(c Connection) {
	m.connections.Store(c.Connection().id, c)
}

func (m *Monitoring) Leave(c Connection) {
	connection := c.Connection()
	_, loaded := m.connections.LoadAndDelete(connection.id)
	if loaded {
		connection.closedAt = time.Now()
		m.closedConnectionsAccess.Lock()
		defer m.closedConnectionsAccess.Unlock()
		if m.closedConnections.Len() >= 1000 {
			m.closedConnections.PopFront()
		}
		m.closedConnections.PushBack(connection)
	}
}

func (m *Monitoring) PushUploaded(size int64) {
	m.uploadTotal.Add(size)
}

func (m *Monitoring) PushDownloaded(size int64) {
	m.downloadTotal.Add(size)
}

func (m *Monitoring) Total() (up int64, down int64) {
	return m.uploadTotal.Load(), m.downloadTotal.Load()
}

func (m *Monitoring) ConnectionsLen() int {
	return m.connections.Len()
}

func (m *Monitoring) Connections() []ConnectionMetadata {
	var connections []ConnectionMetadata
	m.connections.Range(func(_ uuid.UUID, value Connection) bool {
		connections = append(connections, value.Connection())
		return true
	})
	return connections
}

func (m *Monitoring) ClosedConnections() []ConnectionMetadata {
	m.closedConnectionsAccess.Lock()
	defer m.closedConnectionsAccess.Unlock()
	return m.closedConnections.Array()
}

func (m *Monitoring) Connection(id uuid.UUID) Connection {
	connection, loaded := m.connections.Load(id)
	if !loaded {
		return nil
	}
	return connection
}

func (m *Monitoring) CloseProcessConnections(processRegex string, tcp, udp bool) {
	m.connections.Range(func(_ uuid.UUID, value Connection) bool {
		metadata := value.Connection().metadata
		if metadata.ProcessInfo == nil {
			return true
		}
		if matched, _ := regexp.MatchString(processRegex, metadata.ProcessInfo.ProcessPath); !matched {
			return true
		}
		if (tcp && metadata.Network == N.NetworkTCP) || (udp && metadata.Network == N.NetworkUDP) {
			value.Close()
		}
		return true
	})
}

func (m *Monitoring) ResetStatistic() {
	m.uploadTotal.Store(0)
	m.downloadTotal.Store(0)
}
