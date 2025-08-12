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
						Type: C.DNSTypeTLS,
						Tag:  "remote",
						Options: &option.RemoteTLSDNSServerOptions{
							RemoteDNSServerOptions: option.RemoteDNSServerOptions{
								DNSServerAddressOptions: option.DNSServerAddressOptions{
									Server: "8.8.8.8",
									ServerPort: 53,
								},
								LocalDNSServerOptions: option.LocalDNSServerOptions{
									DialerOptions: option.DialerOptions{
										Detour: "zap",
										DomainResolver: &option.DomainResolveOptions{
											Server: "predefined",
										},
									},
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
