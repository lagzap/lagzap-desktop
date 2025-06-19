package coordinator

import (
	"errors"

	"github.com/lagzap/lagzap-desktop/coordinator/handler"
)

// HandleNodesData processes nodes data from SMC messages and emits to frontend
func (c *Coordinator) HandleNodesData(payload *handler.NodesDataPayload) error {
	c.app.EmitEvent("nodes", payload.Nodes)
	return nil
}

// HandleRegionsData processes regions data from SMC messages and emits to frontend
func (c *Coordinator) HandleRegionsData(payload *handler.RegionsDataPayload) error {
	c.app.EmitEvent("regions", payload.Regions)
	return nil
}

// HandleTitlesData processes titles data from SMC messages and emits to frontend
func (c *Coordinator) HandleTitlesData(payload *handler.TitlesDataPayload) error {
	c.app.EmitEvent("titles", payload.Titles)
	return nil
}

// HandleError processes error messages from the server.
func (c *Coordinator) HandleError(payload *handler.ErrorPayload) error {
	if payload == nil {
		return errors.New("unknown_error")
	}
	return errors.New(payload.Message)
}