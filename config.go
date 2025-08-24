package main

import (
	"net/netip"

	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/constant/goos"
	"github.com/lagzap/lagzap/option"
	"github.com/lagzap/zap/common/json/badjson"
	"github.com/lagzap/zap/common/json/badoption"
)

func (c *Service) generateConfig() option.Options {
	predefinedDNS := &badjson.TypedMap[string, badoption.Listable[netip.Addr]]{}
	predefinedDNS.Put("dns.google", []netip.Addr{
		netip.MustParseAddr("8.8.8.8"),
		netip.MustParseAddr("8.8.4.4"),
		netip.MustParseAddr("2001:4860:4860::8844"),
		netip.MustParseAddr("2001:4860:4860::8888"),
	})
	predefinedDNS.Put("dns.google.com", []netip.Addr{
		netip.MustParseAddr("8.8.8.8"),
		netip.MustParseAddr("8.8.4.4"),
		netip.MustParseAddr("2001:4860:4860::8844"),
		netip.MustParseAddr("2001:4860:4860::8888"),
	})
	return option.Options{
		Log: &option.LogOptions{
			Level:        "error",
			Timestamp:    true,
			DisableColor: false,
		},
		Lagzap: &option.LagzapOptions{
			EnableNdis: goos.IsWindows == 1,
			Service:    true,
		},
		DNS: &option.DNSOptions{
			RawDNSOptions: option.RawDNSOptions{
				Rules: []option.DNSRule{
					{
						Tag:  "dns_google",
						Type: C.RuleTypeDefault,
						DefaultOptions: option.DefaultDNSRule{
							RawDefaultDNSRule: option.RawDefaultDNSRule{
								Domain: []string{
									"dns.google",
									"dns.google.com",
								},
							},
							DNSRuleAction: option.DNSRuleAction{
								Action: "route",
								RouteOptions: option.DNSRouteActionOptions{
									Server: "predefined",
								},
							},
						},
					},
				},
				Servers: []option.DNSServerOptions{
					{
						Type: C.DNSTypeLocal,
						Tag:  "local",
					},
					{
						Type: C.DNSTypeHosts,
						Tag:  "predefined",
						Options: &option.HostsDNSServerOptions{
							Predefined: predefinedDNS,
						},
					},
					{
						Type: C.DNSTypeHTTPS,
						Tag:  "remote",
						Options: &option.RemoteHTTPSDNSServerOptions{
							Path:    "/dns-query",
							Method:  "GET",
							Headers: badoption.HTTPHeader{},
							RemoteTLSDNSServerOptions: option.RemoteTLSDNSServerOptions{
								RemoteDNSServerOptions: option.RemoteDNSServerOptions{
									DNSServerAddressOptions: option.DNSServerAddressOptions{
										Server:     "dns.lagzap.network",
										ServerPort: 443,
									},
									LocalDNSServerOptions: option.LocalDNSServerOptions{
										DialerOptions: option.DialerOptions{
											DomainResolver: &option.DomainResolveOptions{
												Server: "local",
											},
										},
									},
								},
								OutboundTLSOptionsContainer: option.OutboundTLSOptionsContainer{
									TLS: &option.OutboundTLSOptions{
										Enabled:    true,
										ServerName: "dns.lagzap.network",
									},
								},
							},
						},
					},
				},
				Final: "remote",
			},
		},
		Inbounds: []option.Inbound{
			// {
			// 	Type: C.TypeHTTP,
			// 	Tag:  "local",
			// 	Options: &option.HTTPInboundOptions{
			// 		ListenOptions: option.ListenOptions{
			// 			ListenPort: 9536,
			// 		},
			// 	},
			// },
			// {
			// 	Type: C.TypeTun,
			// 	Tag:  "tun",
			// 	Options: &option.TunInboundOptions{
			// 		InterfaceName: "LagZap Share",
			// 		Stack: "gvisor",
			// 		Address: []netip.Prefix{netip.MustParsePrefix("192.168.4.0/24")},
			// 		MTU: 1500,
			// 		AutoRoute: true,
			// 		StrictRoute: false,
			// 	},
			// },
			// {
			// 	Type: C.TypeTun,
			// 	Tag:  "tun2",
			// 	Options: &option.TunInboundOptions{
			// 		InterfaceName: "LagZap Adapter",
			// 		Stack: "gvisor",
			// 		Address: []netip.Prefix{
			// 			netip.MustParsePrefix("192.168.5.0/32"),
			// 			netip.MustParsePrefix("fc00::/7"),
			// 		},
			// 		MTU: 1500,
			// 		AutoRoute: false,
			// 		StrictRoute: false,
			// 	},
			// },
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
								},
							},
						},
						RawDefaultRule: option.RawDefaultRule{
							Inbound: []string{"ndis", "tun"},
						},
					},
				},
				{
					Tag:  "002-resolved",
					Type: C.RuleTypeDefault,
					DefaultOptions: option.DefaultRule{
						RuleAction: option.RuleAction{
							Action: C.RuleActionTypeResolve,
						},
						RawDefaultRule: option.RawDefaultRule{
							Inbound: []string{"ndis", "tun"},
						},
					},
				},
				{
					Tag:  "003-hijack-dns",
					Type: C.RuleTypeLogical,
					LogicalOptions: option.LogicalRule{
						RuleAction: option.RuleAction{
							Action: C.RuleActionTypeHijackDNS,
						},
						RawLogicalRule: option.RawLogicalRule{
							Mode: C.LogicalTypeOr,
							Rules: []option.Rule{
								{
									Type: C.RuleTypeDefault,
									DefaultOptions: option.DefaultRule{
										RawDefaultRule: option.RawDefaultRule{
											Protocol: []string{"dns"},
										},
									},
								},
								{
									Type: C.RuleTypeDefault,
									DefaultOptions: option.DefaultRule{
										RawDefaultRule: option.RawDefaultRule{
											Port:    []uint16{53},
										},
									},
								},
							},
						},
					},
				},
			},
			Final: "direct",
			GeoIP:               true,
			FindProcess:         true,
			AutoDetectInterface: true,
		},
	}
}
