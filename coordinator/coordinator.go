package coordinator

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/lagzap/lagzap-desktop/coordinator/handler"
	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/zap/service"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Coordinator struct {
	ctx      context.Context
	cancel   context.CancelFunc
	app      *application.App
	router   adapter.Router
	inbound  adapter.InboundManager
	outbound adapter.OutboundManager
	endpoint adapter.EndpointManager

	url    string
	proxy    string
	token  string
	device string

	cachePath string

	messaging *handler.Service
}

var _ handler.CoordinatorHandler = (*Coordinator)(nil)

func New(ctx context.Context, cancel context.CancelFunc, app *application.App, url, proxy, token, device string) *Coordinator {
	c := &Coordinator{
		ctx:      ctx,
		cancel:   cancel,
		app:      app,
		router:   service.FromContext[adapter.Router](ctx),
		inbound:  service.FromContext[adapter.InboundManager](ctx),
		outbound: service.FromContext[adapter.OutboundManager](ctx),
		endpoint: service.FromContext[adapter.EndpointManager](ctx),

		url:    url,
		proxy:    proxy,
		token:  token,
		device: device,
	}
	cachePath, err := os.UserCacheDir()
	_ = os.Mkdir(cachePath+"\\LagZap", os.ModePerm)
	cachePath += "\\LagZap\\cache.db"
	if err == nil {
		c.cachePath = cachePath
	}
	c.messaging = handler.NewService(ctx, c)
	if c.proxy != "" {
		err = c.messaging.SetProxy(c.proxy)
		if err != nil {
			fmt.Printf("Failed to set proxy: %v\n", err)
		}
	} else {
		c.messaging.SetProxy("")
	}
	return c
}

func (c *Coordinator) Connect() error {
	if err := c.messaging.Connect(); err != nil {
		return fmt.Errorf("failed to connect messaging service: %w", err)
	}
	c.messaging.StartHeartbeatLoop(30 * time.Second)
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-c.ctx.Done():
				return
			case <-ticker.C:
				if !c.messaging.IsConnected() {
					c.messaging.Connect()
				}
			}
		}
	}()
	return nil
}

// Close shuts down the coordinator and closes all connections
func (c *Coordinator) Close() error {
	if c.cancel != nil {
		c.cancel()
	}
	if c.messaging != nil {
		c.messaging.Close()
	}
	return nil
}

// GetURL returns the server URL for the DataHandler interface
func (c *Coordinator) GetURL() string {
	return c.url
}

// GetProxy returns the proxy URL for the DataHandler interface
func (c *Coordinator) GetProxy() string {
	return c.proxy
}

// GetToken returns the access token for the DataHandler interface
func (c *Coordinator) GetToken() string {
	return c.token
}

// GetDevice returns the device identifier for the DataHandler interface
func (c *Coordinator) GetDevice() string {
	return c.device
}
