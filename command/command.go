package command

import (
	"context"
	"sync/atomic"

	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/adapter/echo"
	"github.com/lagzap/zap/service"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Command struct {
	ctx         context.Context
	router      adapter.Router
	inbound     adapter.InboundManager
	outbound    adapter.OutboundManager
	endpoint    adapter.EndpointManager
	testHistory adapter.EchoStorage
	checking    atomic.Bool
	app         *application.App

	echoTestUpdate chan adapter.EchoHookUpdate
}

func New(ctx context.Context, app *application.App) *Command {
	c := &Command{
		ctx:            ctx,
		router:         service.FromContext[adapter.Router](ctx),
		inbound:        service.FromContext[adapter.InboundManager](ctx),
		outbound:       service.FromContext[adapter.OutboundManager](ctx),
		endpoint:       service.FromContext[adapter.EndpointManager](ctx),
		app:            app,
		echoTestUpdate: make(chan adapter.EchoHookUpdate, 1),
	}

	if historyFromCtx := service.PtrFromContext[echo.HistoryStorage](ctx); historyFromCtx != nil {
		historyFromCtx.SetHook(c.echoTestUpdate)
		c.testHistory = historyFromCtx
	}

	go c.listenForEchoTestUpdates()

	return c
}

func (c *Command) listenForEchoTestUpdates() {
	for {
		select {
		case update := <-c.echoTestUpdate:
			c.app.EmitEvent("echo-test", update)
		case <-c.ctx.Done():
			return
		}
	}
}
