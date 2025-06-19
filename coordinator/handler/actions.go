package handler

import (
	"time"

	"google.golang.org/protobuf/proto"
)

// GetRegions requests region information from the server
func (s *Service) ActionTitle(titleAction *TitleAction) error {
	payload, err := proto.Marshal(titleAction)
	if err != nil {
		return err
	}
	message := &CMSMessage{
		Request:   CMSActionTitle,
		Timestamp: time.Now().UnixMilli(),
		HandleId:  generateRequestID(false),
		Payload:   payload,
	}
	return s.handler.SendMessage(message)
}
