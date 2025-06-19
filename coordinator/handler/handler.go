package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"
)

// QueuedMessage represents a message waiting to be sent
type QueuedMessage struct {
	Message   *CMSMessage
	Timestamp time.Time
}

// handler manages the client's connection and handler with the server
type handler struct {
	sync.RWMutex
	ctx          context.Context
	cancel       context.CancelFunc
	conn         *websocket.Conn
	handlers     map[string]HandlerFunc
	responses    map[string]chan *SMCMessage
	listening    bool
	proxyURL     string
	messageQueue []QueuedMessage
}

// newHandler creates a new client messaging service
func newHandler(ctx context.Context) *handler {
	childCtx, cancel := context.WithCancel(ctx)

	return &handler{
		handlers:     make(map[string]HandlerFunc),
		responses:    make(map[string]chan *SMCMessage),
		ctx:          childCtx,
		cancel:       cancel,
		messageQueue: make([]QueuedMessage, 0),
	}
}

// SetConnection sets the WebSocket connection for the service with proper configuration
func (s *handler) SetConnection(conn *websocket.Conn, clientID string) {
	s.Lock()
	defer s.Unlock()

	// Refresh context if it was cancelled
	if s.ctx.Err() != nil {
		s.ctx, s.cancel = context.WithCancel(context.Background())
	}

	if s.conn != nil {
		s.conn.Close()
	}

	conn.SetReadLimit(65536)
	conn.SetReadDeadline(time.Now().Add(300 * time.Second)) // 5 minutes
	conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
	conn.SetPongHandler(func(appData string) error {
		return conn.SetReadDeadline(time.Now().Add(300 * time.Second))
	})
	conn.SetPingHandler(func(appData string) error {
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteMessage(websocket.PongMessage, nil)
	})
	s.conn = conn

	// Process queued messages after connection is established
	go s.processQueuedMessages()

	if !s.listening {
		s.listening = true
		go s.listenForMessages()
		go s.pingLoop()
	}
}

// RegisterHandler registers a handler for a specific message type from server
func (s *handler) RegisterHandler(messageType string, handler HandlerFunc) {
	s.Lock()
	defer s.Unlock()
	s.handlers[messageType] = handler
}

// SendRequest sends a request to the server and waits for a response
func (s *handler) SendRequest(message *CMSMessage, timeout time.Duration) (*SMCMessage, error) {
	s.RLock()
	conn := s.conn
	s.RUnlock()

	if conn == nil {
		return nil, fmt.Errorf("no active connection")
	}

	respChan := make(chan *SMCMessage, 1)
	s.Lock()
	s.responses[message.HandleId] = respChan
	s.Unlock()

	defer func() {
		s.Lock()
		delete(s.responses, message.HandleId)
		s.Unlock()
		close(respChan)
	}()

	if err := s.SendMessage(message); err != nil {
		return nil, err
	}

	select {
	case response := <-respChan:
		return response, nil
	case <-time.After(timeout):
		return nil, fmt.Errorf("request timeout after %v", timeout)
	case <-s.ctx.Done():
		return nil, s.ctx.Err()
	}
}

// SendMessage sends a message with proper timeout handling
func (s *handler) SendMessage(message *CMSMessage) error {
	s.Lock()
	defer s.Unlock()

	if s.conn == nil {
		// Queue the message if no connection is available
		s.messageQueue = append(s.messageQueue, QueuedMessage{
			Message:   message,
			Timestamp: time.Now(),
		})
		return nil
	}

	data, err := proto.Marshal(message)
	if err != nil {
		return fmt.Errorf("failed to marshal protobuf message: %w", err)
	}

	s.conn.SetWriteDeadline(time.Now().Add(15 * time.Second))
	err = s.conn.WriteMessage(websocket.BinaryMessage, data)
	if err != nil {
		// If send fails, queue the message for retry
		s.messageQueue = append(s.messageQueue, QueuedMessage{
			Message:   message,
			Timestamp: time.Now(),
		})
		return fmt.Errorf("failed to send protobuf message: %w", err)
	}
	return nil
}

// Close closes the messaging service
func (s *handler) Close() error {
	s.Lock()
	if s.cancel != nil {
		s.cancel()
	}
	s.Unlock()

	s.Lock()
	defer s.Unlock()

	if s.conn != nil {
		err := s.conn.Close()
		s.conn = nil
		s.listening = false
		return err
	}

	return nil
}

// IsConnected returns true if the service has an active connection
func (s *handler) IsConnected() bool {
	s.RLock()
	defer s.RUnlock()
	return s.conn != nil
}

// EnsureListenerRunning starts the message listener if it's not already running
func (s *handler) EnsureListenerRunning() {
	s.Lock()
	defer s.Unlock()

	if !s.listening && s.conn != nil {
		s.listening = true
		go s.listenForMessages()
	}
}

// processQueuedMessages sends all queued messages in order after connection is established
func (s *handler) processQueuedMessages() {
	s.Lock()
	defer s.Unlock()

	if s.conn == nil || len(s.messageQueue) == 0 {
		return
	}

	// Send queued messages in order
	var remainingQueue []QueuedMessage
	for _, queuedMsg := range s.messageQueue {
		data, err := proto.Marshal(queuedMsg.Message)
		if err != nil {
			// Keep failed marshaling messages in queue for retry
			remainingQueue = append(remainingQueue, queuedMsg)
			continue
		}

		s.conn.SetWriteDeadline(time.Now().Add(15 * time.Second))
		err = s.conn.WriteMessage(websocket.BinaryMessage, data)
		if err != nil {
			// Keep failed messages in queue for retry
			remainingQueue = append(remainingQueue, queuedMsg)
			continue
		}

		fmt.Printf("Sent queued message: %s\n", queuedMsg.Message.Request)
	}

	// Update queue with only failed messages
	s.messageQueue = remainingQueue
}

// SetProxy sets the proxy URL for websocket connections
func (s *handler) SetProxy(proxyURL string) error {
	s.Lock()
	defer s.Unlock()
	s.proxyURL = proxyURL
	return nil
}

// listenForMessages listens for messages from the server
func (s *handler) listenForMessages() {
	defer func() {
		s.Lock()
		s.listening = false
		s.Unlock()
	}()

	for {
		select {
		case <-s.ctx.Done():
			return
		default:
		}

		s.RLock()
		if s.conn == nil {
			s.RUnlock()
			time.Sleep(1 * time.Second)
			continue
		}
		s.RUnlock()

		s.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		messageType, data, err := s.conn.ReadMessage()

		if err != nil {
			s.Lock()
			s.conn = nil
			s.Unlock()
			return
		}

		if messageType != websocket.BinaryMessage {
			continue
		}

		smcMessage := &SMCMessage{}
		if err := proto.Unmarshal(data, smcMessage); err != nil {
			continue
		}
		if smcMessage.HandleId != "" {
			s.RLock()
			respChan, exists := s.responses[smcMessage.HandleId]
			s.RUnlock()

			if exists {
				respChan <- smcMessage
			}
		}
		s.RLock()
		handler, exists := s.handlers[smcMessage.Response]
		s.RUnlock()

		if exists {
			go func(h HandlerFunc, msg *SMCMessage) {
				defer func() {
					if r := recover(); r != nil {
						fmt.Printf("Handler panic for message type %s: %v\n", msg.Response, r)
					}
				}()
				if err := h(msg); err != nil {
					fmt.Printf("Handler error for message type %s: %v\n", msg.Response, err)
				}
			}(handler, smcMessage)
		}
	}
}

// pingLoop periodically sends ping messages to the server to keep the connection alive
func (s *handler) pingLoop() {
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.RLock()
			conn := s.conn
			s.RUnlock()

			if conn == nil {
				return
			}

			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				s.Lock()
				if s.conn == conn {
					s.conn = nil
				}
				s.Unlock()
				return
			}
		}
	}
}

// generateRequestID generates a unique message ID
func generateRequestID(request bool) string {
	if !request {
		return ""
	}
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}
