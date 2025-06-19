package coordinator

import "github.com/lagzap/lagzap-desktop/coordinator/handler"

func (c *Coordinator) ActionTitle(titleAction *handler.TitleAction) error {
	return c.messaging.ActionTitle(titleAction)
}
