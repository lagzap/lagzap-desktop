package handler

import (
	"errors"
)

// Message types for CMS (Client to Server)
const (
	CMSHeartbeat    = "heartbeat"
	CMSCheckSession = "check_session"
	CMSGetNodes     = "get_nodes"
	CMSGetRegions   = "get_regions"
	CMSGetTitles    = "get_titles"

	CMSActionTitle  = "action_title"
)

// Message types for SMC (Server to Client)
const (
	SMCError         = "error"
	SMCNotification  = "notification"
	SMCHeartbeat     = "heartbeat"
	SMCNodesData     = "nodes_data"
	SMCRegionsData   = "regions_data"
	SMCTitlesData    = "titles_data"
)

// Error types
var (
	ErrClientNotFound      = errors.New("client not found")
	ErrClientChannelClosed = errors.New("client channel closed")
	ErrInvalidPayload      = errors.New("invalid payload")
	ErrInvalidMessageType  = errors.New("invalid message type")
	ErrConnectionClosed    = errors.New("connection closed")
	ErrProtocolMismatch    = errors.New("protocol mismatch")
)

// HandlerFunc represents a function that handles SMC messages from server
type HandlerFunc func(message *SMCMessage) error

// ResponseHandler represents a function that handles responses to specific requests
type ResponseHandler func(message *SMCMessage) error

// DataHandler interface for handling SMC data messages
type DataHandler interface {
	HandleNodesData(payload *NodesDataPayload) error
	HandleRegionsData(payload *RegionsDataPayload) error
	HandleTitlesData(payload *TitlesDataPayload) error

	GetURL() string
	GetToken() string
	GetDevice() string
}
