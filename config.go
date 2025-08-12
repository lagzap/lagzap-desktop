package main

import (
	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/constant/goos"
	"github.com/lagzap/lagzap/option"
)

func (c *Service) generateConfig() option.Options {
	return option.Options{
		Log: &option.LogOptions{
			Level:        "info",
			Timestamp:    true,
			DisableColor: false,
		},
		Lagzap: &option.LagzapOptions{
			EnableNdis: goos.IsWindows == 1,
			Optimizer:  true,
			Service:    true,
		},
		DNS: &option.DNSOptions{
			RawDNSOptions: option.RawDNSOptions{
				Servers: []option.DNSServerOptions{
					{
						Type: C.DNSTypeLocal,
						Tag:  "local",
					},
					{
						Type: C.DNSTypeDHCP,
						Tag:  "dhcp",
						Options: &option.DHCPDNSServerOptions{
							LocalDNSServerOptions: option.LocalDNSServerOptions{
								DialerOptions: option.DialerOptions{
									Detour: "zap",
								},
							},
						},
					},
					{
						Type: C.DNSTypeFakeIP,
						Tag:  "fake-ip",
					},
				},
				Final: "local",
			},
		},
		Inbounds: []option.Inbound{},
		Outbounds: []option.Outbound{
			{
				Type: C.TypeDirect,
				Tag:  "direct",
				Options: &option.DirectOutboundOptions{
					DialerOptions: option.DialerOptions{},
				},
			},
			{
				Type:    C.TypeZap,
				Tag:     "zap",
				Options: &option.StubOptions{},
			},
		},
		Route: &option.RouteOptions{
			Rules: []option.Rule{
				{
					Tag:  "001-sniff",
					Type: C.RuleTypeDefault,
					DefaultOptions: option.DefaultRule{
						RuleAction: option.RuleAction{
							Action: C.RuleActionTypeSniff,
							SniffOptions: option.RouteActionSniff{
								Sniffer: []string{
									"http",
									"tls",
									"dns",
									"dtls",
								},
							},
						},
						RawDefaultRule: option.RawDefaultRule{
							Inbound: []string{"ndis"},
						},
					},
				},
				{
					Tag:  "002-hijack-dns",
					Type: C.RuleTypeDefault,
					DefaultOptions: option.DefaultRule{
						RuleAction: option.RuleAction{
							Action: C.RuleActionTypeHijackDNS,
						},
						RawDefaultRule: option.RawDefaultRule{
							Inbound: []string{"ndis"},
							Port:    []uint16{53, 853},
						},
					},
				},
			},
			Final:               "direct",
			GeoIP:               true,
			FindProcess:         true,
			AutoDetectInterface: true,
		},
	}
}
