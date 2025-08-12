package main

import (
	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/option"
)

func (c *Service) generateConfig(hostname, accessToken, logLevel, dns string) option.Options {
	return option.Options{
		Log: &option.LogOptions{
			Level:        logLevel,
			Timestamp:    true,
			DisableColor: false,
		},
		Lagzap: &option.LagzapOptions{
			EnableNdis: true,
			Optimizer: &option.OptimizerOptions{
				Enabled: true,
			},
			Service: &option.CoordinatorOptions{
				Enabled:     true,
				Server:      hostname,
				AccessToken: accessToken,
			},
			Debug: &option.DebugOptions{
				// 		Listen: "127.0.0.1:1265",
				// 		MemoryLimit: option.MemoryBytes(100 * 1024 * 1024), // 100 MB
			},
		},
		DNS: &option.DNSOptions{
			RawDNSOptions: option.RawDNSOptions{
				Servers: []option.DNSServerOptions{
					{
						Type: C.DNSTypeLocal,
						Tag:  "local",
					},
					// {
					// 	Type: C.DNSTypeDHCP,
					// 	Tag:  "dhcp",
					// 	Options: &option.DHCPDNSServerOptions{
					// 		LocalDNSServerOptions: option.LocalDNSServerOptions{
					// 			DialerOptions: option.DialerOptions{
					// 				Detour: "zap",
					// 			},
					// 		},
					// 	},
					// },
					{
						Type: C.DNSTypeFakeIP,
						Tag:  "fake-ip",
					},
					{
						Type: C.DNSTypeUDP,
						Tag:  "remote",
						Options: &option.RemoteDNSServerOptions{
							LocalDNSServerOptions: option.LocalDNSServerOptions{
								DialerOptions: option.DialerOptions{
									Detour: "zap",
								},
							},
							DNSServerAddressOptions: option.DNSServerAddressOptions{
								Server:     dns,
								ServerPort: 53,
							},
						},
					},
				},
				Final: "local",
			},
		},
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
				// {
				// 	Tag:  "003-dns",
				// 	Type: C.RuleTypeDefault,
				// 	DefaultOptions: option.DefaultRule{
				// 		RuleAction: option.RuleAction{
				// 			Action: C.RuleActionTypeRoute,
				// 			RouteOptions: option.RouteActionOptions{
				// 				Outbound: "zap",
				// 			},
				// 		},
				// 		RawDefaultRule: option.RawDefaultRule{
				// 			Inbound: []string{"ndis"},
				// 		},
				// 	},
				// },
			},
			Final: "direct",
			GeoIP: &option.GeoIPOptions{
				Enabled: true,
			},
			RuleSet:             []option.RuleSet{},
			FindProcess:         true,
			AutoDetectInterface: true,
		},
	}
}
