package coordinator

import (
	"errors"

	"github.com/lagzap/lagzap-desktop/coordinator/handler"
	"google.golang.org/protobuf/proto"
)

func (c *Coordinator) CheckSession() (*handler.SessionCredentialsPayload, error) {
	message, err := c.messaging.CheckSession()
	if err != nil {
		return nil, err
	}
	if !message.Success {
		return nil, c.messaging.HandleError(message)
	}
	var payload handler.SessionCredentialsPayload
	if err := proto.Unmarshal(message.Payload, &payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

func (c *Coordinator) GetRegions() (err error) {
	_, err = c.messaging.Get(handler.CMSGetRegions)
	return
}

func (c *Coordinator) GetTitles() (err error) {
	_, err = c.messaging.Get(handler.CMSGetTitles)
	return
}

func (c *Coordinator) GetNodes() (err error) {
	_, err = c.messaging.Get(handler.CMSGetNodes)
	return
}

// get is a generic helper for handling requests and unmarshaling responses
func (c *Coordinator) get(messageType string, request bool, payload proto.Message) error {
	message, err := c.messaging.Get(messageType)
	if err != nil {
		return err
	}
	if !request && message == nil {
		return errors.New("received empty message from server")
	}
	if !message.Success {
		return c.messaging.HandleError(message)
	}
	return proto.Unmarshal(message.Payload, payload)
}
