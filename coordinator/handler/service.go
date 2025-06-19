package handler

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/lagzap/lagzap-desktop/constant"
	"golang.org/x/net/proxy"
	"google.golang.org/protobuf/proto"
)

// CoordinatorHandler interface for handling SMC data messages
type CoordinatorHandler interface {
	HandleNodesData(payload *NodesDataPayload) error
	HandleRegionsData(payload *RegionsDataPayload) error
	HandleTitlesData(payload *TitlesDataPayload) error
	HandleError(payload *ErrorPayload) error

	GetURL() string
	GetToken() string
	GetDevice() string
}

type Service struct {
	ctx         context.Context
	cancel      context.CancelFunc
	mutex       sync.RWMutex
	handler     *handler
	coordinator CoordinatorHandler

	serverURL        string
	deviceHash       string
	accessToken      string
	isConnected      bool
	heartbeatStarted bool
}

// NewService creates a new coordinator messaging service
func NewService(ctx context.Context, coordinator CoordinatorHandler) *Service {
	childCtx, cancel := context.WithCancel(ctx)
	return &Service{
		ctx:         childCtx,
		cancel:      cancel,
		handler:     newHandler(childCtx),
		coordinator: coordinator,

		serverURL:   coordinator.GetURL(),
		deviceHash:  coordinator.GetDevice(),
		accessToken: coordinator.GetToken(),
	}
}

// setupMessageHandlers registers handlers for different message types from server
func (s *Service) setupMessageHandlers() {
	// Data handlers - these delegate to coordinator for processing
	s.handler.RegisterHandler(SMCError, s.HandleError)
	s.handler.RegisterHandler(SMCNodesData, s.handleNodesData)
	s.handler.RegisterHandler(SMCRegionsData, s.handleRegionsData)
	s.handler.RegisterHandler(SMCTitlesData, s.handleTitlesData)

	// System handlers
	s.handler.RegisterHandler(SMCHeartbeat, s.handleHeartbeat)
}

// Data message handlers - these forward to coordinator
func (s *Service) handleNodesData(message *SMCMessage) error {
	var payload NodesDataPayload
	if err := proto.Unmarshal(message.Payload, &payload); err != nil {
		return err
	}
	return s.coordinator.HandleNodesData(&payload)
}

func (s *Service) handleRegionsData(message *SMCMessage) error {
	var payload RegionsDataPayload
	if err := proto.Unmarshal(message.Payload, &payload); err != nil {
		return err
	}
	return s.coordinator.HandleRegionsData(&payload)
}

func (s *Service) handleTitlesData(message *SMCMessage) error {
	var payload TitlesDataPayload
	if err := proto.Unmarshal(message.Payload, &payload); err != nil {
		return err
	}
	return s.coordinator.HandleTitlesData(&payload)
}

// System message handlers 
func (s *Service) handleHeartbeat(message *SMCMessage) error {
	// Handle heartbeat from server - no processing needed, just acknowledge
	return nil
}


func (s *Service) HandleError(message *SMCMessage) error {
	var payload ErrorPayload
	if err := proto.Unmarshal(message.Payload, &payload); err != nil {
		return err
	}
	return s.coordinator.HandleError(&payload)
}

// Connect establishes a WebSocket connection to the server
func (s *Service) Connect() error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.isConnected && s.handler.IsConnected() {
		return nil
	}
	if s.handler != nil {
		s.handler.Close()
	}
	
	wsURL := fmt.Sprintf("%s/lagzap.Coordinate", s.serverURL)

	dialer := websocket.Dialer{
		ReadBufferSize:    16384,
		WriteBufferSize:   16384,
		HandshakeTimeout:  30 * time.Second,
		EnableCompression: true,
		NetDialContext:    nil,
	}
	// Configure proxy if set
	if s.handler != nil {
		s.handler.RLock()
		proxyURL := s.handler.proxyURL
		s.handler.RUnlock()

		if proxyURL != "" {
			dialFunc, err := s.createProxyDialer(proxyURL)
			if err != nil {
				s.isConnected = false
				return fmt.Errorf("failed to create proxy dialer: %w", err)
			}
			dialer.NetDialContext = dialFunc
		}
	}

	header := http.Header{}
	header.Set("Authorization", "Bearer "+s.accessToken)
	header.Set("Client-ID", s.deviceHash)
	header.Set("User-Agent", constant.UserAgent)
	conn, _, err := dialer.Dial(wsURL, header)
	if err != nil {
		s.isConnected = false
		return fmt.Errorf("failed to connect to %s: %w", wsURL, err)
	}
	s.handler.SetConnection(conn, s.deviceHash)
	s.setupMessageHandlers()
	s.isConnected = true

	return nil
}

// Disconnect closes the connection to the server
func (s *Service) Disconnect() error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if !s.isConnected {
		return nil
	}
	s.isConnected = false
	if s.handler != nil {
		return s.handler.Close()
	}
	return nil
}

// IsConnected returns true if connected to the server
func (s *Service) IsConnected() bool {
	s.mutex.RLock()
	localConnected := s.isConnected
	s.mutex.RUnlock()

	if !localConnected {
		return false
	}

	messagingConnected := s.handler.IsConnected()

	if !messagingConnected {
		s.mutex.Lock()
		s.isConnected = false
		s.mutex.Unlock()
		return false
	}

	return true
}

// StartHeartbeatLoop starts a periodic heartbeat with the server
func (s *Service) StartHeartbeatLoop(interval time.Duration) {
	s.mutex.Lock()
	if s.heartbeatStarted {
		s.mutex.Unlock()
		return
	}
	s.heartbeatStarted = true
	s.mutex.Unlock()

	go func() {
		defer func() {
			s.mutex.Lock()
			s.heartbeatStarted = false
			s.mutex.Unlock()
		}()

		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-ticker.C:
				if s.IsConnected() {
					if err := s.sendHeartbeat(); err == nil {
						continue
					}
					s.mutex.Lock()
					s.isConnected = false
					s.mutex.Unlock()
				}
			}
		}
	}()
}

// sendHeartbeat sends a heartbeat message to the server
func (s *Service) sendHeartbeat() error {
	message := &CMSMessage{
		Request:   CMSHeartbeat,
		Timestamp: time.Now().UnixMilli(),
		HandleId: generateRequestID(false),
	}
	data, err := proto.Marshal(&HeartbeatPayload{
		Timestamp: time.Now().UnixMilli(),
		Status:    "online",
	})
	if err != nil {
		return err
	}
	message.Payload = data
	return s.handler.SendMessage(message)
}

// RegisterHandler registers a message handler for a specific message type
func (s *Service) RegisterHandler(messageType string, handler HandlerFunc) {
	if s.handler != nil {
		s.handler.RegisterHandler(messageType, handler)
	}
}

// Close shuts down the messaging service
func (s *Service) Close() error {
	s.cancel()
	return s.Disconnect()
}

// SetProxy sets the proxy URL for websocket connections
func (s *Service) SetProxy(proxyURL string) error {
	if s.handler != nil {
		return s.handler.SetProxy(proxyURL)
	}
	return nil
}

// createProxyDialer creates a network dialer that uses the specified proxy
func (s *Service) createProxyDialer(proxyURL string) (func(ctx context.Context, network, addr string) (net.Conn, error), error) {
	u, err := url.Parse(proxyURL)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy URL: %w", err)
	}

	baseDialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	switch u.Scheme {
	case "socks5", "socks5h":
		// Create SOCKS5 proxy dialer
		socksDialer, err := proxy.SOCKS5("tcp", u.Host, nil, baseDialer)
		if err != nil {
			return nil, fmt.Errorf("failed to create SOCKS5 proxy: %w", err)
		}
		
		// Return a function that uses the SOCKS proxy
		return func(ctx context.Context, network, addr string) (net.Conn, error) {
			return socksDialer.Dial(network, addr)
		}, nil
		
	case "http", "https":
		// For HTTP proxies, we need to use HTTP CONNECT method
		return func(ctx context.Context, network, addr string) (net.Conn, error) {
			// Connect to proxy server
			proxyConn, err := baseDialer.DialContext(ctx, "tcp", u.Host)
			if err != nil {
				return nil, fmt.Errorf("failed to connect to HTTP proxy: %w", err)
			}
			
			// Send HTTP CONNECT request
			connectReq := fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", addr, addr)
			_, err = proxyConn.Write([]byte(connectReq))
			if err != nil {
				proxyConn.Close()
				return nil, fmt.Errorf("failed to send CONNECT request: %w", err)
			}
			
			// Read response
			buffer := make([]byte, 1024)
			n, err := proxyConn.Read(buffer)
			if err != nil {
				proxyConn.Close()
				return nil, fmt.Errorf("failed to read CONNECT response: %w", err)
			}
			
			response := string(buffer[:n])
			if !strings.Contains(response, "200 Connection established") {
				proxyConn.Close()
				return nil, fmt.Errorf("HTTP proxy CONNECT failed: %s", response)
			}
			
			return proxyConn, nil
		}, nil
		
	default:
		return nil, fmt.Errorf("unsupported proxy scheme: %s", u.Scheme)
	}
}
