package main

import (
	"context"
	"fmt"
	"net/netip"
	"time"

	"github.com/lagzap/lagzap"
	"github.com/lagzap/lagzap/adapter"
	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/include"
	"github.com/lagzap/lagzap/option"
	"github.com/lagzap/lagzap/protocol/http"
	"github.com/lagzap/zap/common/json/badoption"
)

type Internal struct {
	adapter.LifecycleService
	ctx    context.Context
	lagzap *lagzap.LagZap
}

func NewInternal(ctx context.Context) *Internal {
	s := &Internal{}
	s.ctx = lagzap.Context(ctx, include.InboundRegistry(), include.OutboundRegistry(), include.EndpointRegistry(), include.DNSTransportRegistry())
	options := s.generateConfig()
	instance, err := lagzap.New(lagzap.Options{
		Context: s.ctx,
		Options: options,
	})
	if err != nil {
		panic(err)
	}
	instance.Start()
	s.lagzap = instance
	return s
}

func (s *Internal) Close() error {
	return s.lagzap.Close()
}

func (s *Internal) ProxyAddr() string {
	inbound, ok := s.lagzap.Inbound().Get("http-in")
	if !ok {
		return "direct://"
	}
	return fmt.Sprintf("http://%s", inbound.(*http.Inbound).Addr())
}

func (c *Internal) generateConfig() option.Options {
	listenAddr := badoption.Addr(netip.MustParseAddr("127.0.0.1"))

	return option.Options{
		Log: &option.LogOptions{
			Level:        "trace",
			Timestamp:    true,
			DisableColor: true,
		},
		DNS: &option.DNSOptions{
			RawDNSOptions: option.RawDNSOptions{
				Rules: []option.DNSRule{
				},
				Servers: []option.DNSServerOptions{
					{
						Type:    C.DNSTypeLocal,
						Tag:     "local",
						Options: &option.LocalDNSServerOptions{},
					},
				},
				Final: "local",
			},
		},
		Inbounds: []option.Inbound{
			{
				Type: C.TypeHTTP,
				Tag:  "http-in",
				Options: &option.HTTPInboundOptions{
					ListenOptions: option.ListenOptions{
						Listen: &listenAddr,
					},
				},
			},
		},
		Outbounds: []option.Outbound{
			{
				Type: C.TypeDirect,
				Tag:  "direct",
				Options: &option.DirectOutboundOptions{
					DialerOptions: option.DialerOptions{
						TCPFastOpen:  true,
						TCPMultiPath: true,
					},
				},
			},
		},
		Route: &option.RouteOptions{
			Rules: []option.Rule{
				{
					Tag:  "sniff",
					Type: C.RuleTypeDefault,
					DefaultOptions: option.DefaultRule{
						RuleAction: option.RuleAction{
							Action: "sniff",
							SniffOptions: option.RouteActionSniff{
								Sniffer: []string{
									"http",
									"tls",
									"dns",
									"dtls",
								},
								Timeout: badoption.Duration(time.Second),
							},
						},
						RawDefaultRule: option.RawDefaultRule{},
					},
				},
				{
					Tag:  "route-lagzap-network",
					Type: C.RuleTypeDefault,
					DefaultOptions: option.DefaultRule{
						RawDefaultRule: option.RawDefaultRule{
							Inbound: []string{
								"http-in",
							},
							DomainSuffix: []string{
								"lagzap.network",
								"lagzap-network.ir",
							},
						},
						RuleAction: option.RuleAction{
							Action: "route",
							RouteOptions: option.RouteActionOptions{
								Outbound: "direct",
							},
						},
					},
				},
				{
					Tag:  "route-other",
					Type: C.RuleTypeDefault,
					DefaultOptions: option.DefaultRule{
						RawDefaultRule: option.RawDefaultRule{
							Inbound: []string{
								"http-in",
							},
						},
						RuleAction: option.RuleAction{
							Action: "route",
							RouteOptions: option.RouteActionOptions{
								Outbound: "direct",
							},
						},
					},
				},
			},
			Final:               "direct",
			AutoDetectInterface: true,
		},
	}
}
