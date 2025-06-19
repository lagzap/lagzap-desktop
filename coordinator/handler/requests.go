package handler

import (
	"runtime"
	"time"

	"github.com/lagzap/lagzap-desktop/constant"
	"google.golang.org/protobuf/proto"
)

// GetRegions requests region information from the server
func (s *Service) CheckSession() (*SMCMessage, error) {
	session := &SessionPayload{
		DeviceHash:    s.deviceHash,
		Os:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		AppVersion:    constant.Version,
		ClientVersion: constant.Version,
	}
	payload, err := proto.Marshal(session)
	if err != nil {
		return nil, err
	}
	message := &CMSMessage{
		Request:   CMSCheckSession,
		Timestamp: time.Now().UnixMilli(),
		HandleId:  generateRequestID(true),
		Payload:   payload,
	}
	return s.handler.SendRequest(message, 30*time.Second)
}

// GetRegions requests region information from the server
func (s *Service) Get(request string) (*SMCMessage, error) {
	return s.handler.SendRequest(&CMSMessage{
		Request:   request,
		Timestamp: time.Now().UnixMilli(),
		HandleId:  generateRequestID(true),
	}, 30*time.Second)
}

// GetRegions requests region information from the server
func (s *Service) Send(request string) error {
	return s.handler.SendMessage(&CMSMessage{
		Request:   request,
		Timestamp: time.Now().UnixMilli(),
		HandleId:  generateRequestID(false),
	})
}
