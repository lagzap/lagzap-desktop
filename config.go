package main

import (
	"net/netip"

	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/constant/goos"
	"github.com/lagzap/lagzap/option"
	"github.com/lagzap/zap/common/debug"
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
	predefinedDNS.Put("dev.lagzap.network", []netip.Addr{
		netip.MustParseAddr("104.19.229.21"),
		netip.MustParseAddr("104.19.230.21"),
		netip.MustParseAddr("104.17.148.22"),
		netip.MustParseAddr("104.17.147.22"),
	})
	predefinedDNS.Put("dns.google.com", []netip.Addr{
		netip.MustParseAddr("8.8.8.8"),
		netip.MustParseAddr("8.8.4.4"),
		netip.MustParseAddr("2001:4860:4860::8844"),
		netip.MustParseAddr("2001:4860:4860::8888"),
	})
	inet4Range := badoption.Prefix{}
	inet4Range.Build(netip.MustParsePrefix("172.18.0.1/24"))
	inet6Range := badoption.Prefix{}
	inet6Range.Build(netip.MustParsePrefix("fdfe:dcba:9876::1/126"))
	var queryTypeA option.DNSQueryType
	queryTypeA.UnmarshalJSON([]byte("A"))
	var queryTypeAAAA option.DNSQueryType
	queryTypeAAAA.UnmarshalJSON([]byte("AAAA"))
	queryTypes := []option.DNSQueryType{
		queryTypeA,
		queryTypeAAAA,
	}
	var debugOptions *option.DebugOptions
	if debug.Enabled {
		var maxThreads int = 999999999
		debugOptions = &option.DebugOptions{
			Listen:      "127.0.0.1:6060",
			MemoryLimit: option.MemoryBytes(1 * 1024 * 1024 * 1024),
			MaxThreads:  &maxThreads,
		}
	}

	return option.Options{
		Log: &option.LogOptions{
			Level:        "error",
			Timestamp:    false,
			DisableColor: false,
		},
		Lagzap: &option.LagzapOptions{
			EnableNdis: goos.IsWindows == 1,
			Service:    true,
			Debug:      debugOptions,
		},
		DNS: &option.DNSOptions{
			RawDNSOptions: option.RawDNSOptions{
				Rules: []option.DNSRule{
					{
						Tag:  "bootstrap",
						Type: C.RuleTypeDefault,
						DefaultOptions: option.DefaultDNSRule{
							RawDefaultDNSRule: option.RawDefaultDNSRule{
								Domain: []string{
									"gstatic.com",
									"www.gstatic.com",
								},
								DomainSuffix: []string{
									"lagzap.network",
									"lagzap-network.ir",
								},
							},
							DNSRuleAction: option.DNSRuleAction{
								Action: "route",
								RouteOptions: option.DNSRouteActionOptions{
									Server: "bootstrap",
								},
							},
						},
					},
					{
						Tag:  "dns_google",
						Type: C.RuleTypeDefault,
						DefaultOptions: option.DefaultDNSRule{
							RawDefaultDNSRule: option.RawDefaultDNSRule{
								Domain: []string{
									"dns.google",
									"dns.google.com",
									"dev.lagzap.network",
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
					{
						Tag:   "fakeip",
						Order: 10000,
						Type:  C.RuleTypeDefault,
						DefaultOptions: option.DefaultDNSRule{
							RawDefaultDNSRule: option.RawDefaultDNSRule{
								QueryType: queryTypes,
							},
							DNSRuleAction: option.DNSRuleAction{
								Action: "route",
								RouteOptions: option.DNSRouteActionOptions{
									Server: "fakeip",
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
						Type: C.DNSTypeFakeIP,
						Tag:  "fakeip",
						Options: &option.FakeIPDNSServerOptions{
							Inet4Range: &inet4Range,
							Inet6Range: &inet6Range,
						},
					},
					{
						Type: C.DNSTypeUDP,
						Tag:  "bootstrap",
						Options: &option.RemoteDNSServerOptions{
							DNSServerAddressOptions: option.DNSServerAddressOptions{
								Server:     "8.8.8.8",
								ServerPort: 53,
							},
						},
					},
					{
						Type:    C.DNSTypeUDP,
						Tag:     "remote-lagzap",
						Options: remoteLagZapDNSServerOptions(c.proxyDNSRequests),
					},
					{
						Type:    C.DNSTypeUDP,
						Tag:     "remote-lagzap-proxied",
						Options: remoteLagZapProxiedDNSServerOptions(),
					},
				},
				Final: c.dnsFinal(),
			},
		},
		Outbounds: []option.Outbound{
			{
				Type: C.TypeDirect,
				Tag:  "direct",
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
					Tag:   "sniff",
					Order: 1,
					Type:  C.RuleTypeDefault,
					DefaultOptions: option.DefaultRule{
						RawDefaultRule: option.RawDefaultRule{
							Inbound: []string{"ndis", "tun"},
						},
						RuleAction: option.RuleAction{
							Action:       C.RuleActionTypeSniff,
							SniffOptions: option.RouteActionSniff{},
						},
					},
				},
				{
					Tag:   "hijack-dns",
					Order: 2,
					Type:  C.RuleTypeLogical,
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
											Port: []uint16{53},
										},
									},
								},
							},
						},
					},
				},
			},
			GeoIP:               true,
			FindProcess:         true,
			AutoDetectInterface: false,
		},
	}
}

func (c *Service) dnsFinal() string {
	if c.proxyDNSRequests {
		return "remote-lagzap"
	}
	return "local"
}

func remoteLagZapDNSServerOptions(proxyDNS bool) *option.RemoteDNSServerOptions {
	opts := &option.RemoteDNSServerOptions{
		DNSServerAddressOptions: option.DNSServerAddressOptions{
			Server:     "8.8.8.8",
			ServerPort: 53,
		},
	}
	if proxyDNS {
		opts.LocalDNSServerOptions = option.LocalDNSServerOptions{
			DialerOptions: option.DialerOptions{
				Detour: "zap",
			},
		}
	}
	return opts
}

func remoteLagZapProxiedDNSServerOptions() *option.RemoteDNSServerOptions {
	return &option.RemoteDNSServerOptions{
		DNSServerAddressOptions: option.DNSServerAddressOptions{
			Server:     "8.8.8.8",
			ServerPort: 53,
		},
		LocalDNSServerOptions: option.LocalDNSServerOptions{
			DialerOptions: option.DialerOptions{
				Detour: "zap",
			},
		},
	}
}
