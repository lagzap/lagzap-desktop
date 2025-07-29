package main

import (
	"net/netip"

	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/option"
	"github.com/lagzap/zap/common/json/badjson"
	"github.com/lagzap/zap/common/json/badoption"
)

func (c *Service) generateConfig(serverURL, accessToken string) option.Options {
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
	cloudflare := []netip.Addr{
		netip.MustParseAddr("104.21.64.1"),
		netip.MustParseAddr("104.21.112.1"),
		netip.MustParseAddr("104.21.32.1"),
		netip.MustParseAddr("104.21.96.1"),
		netip.MustParseAddr("104.21.80.1"),
		netip.MustParseAddr("104.21.16.1"),
		netip.MustParseAddr("104.21.48.1"),
		netip.MustParseAddr("2606:4700:3030::6815:3001"),
		netip.MustParseAddr("2606:4700:3030::6815:6001"),
		netip.MustParseAddr("2606:4700:3030::6815:1001"),
		netip.MustParseAddr("2606:4700:3030::6815:7001"),
		netip.MustParseAddr("2606:4700:3030::6815:2001"),
		netip.MustParseAddr("2606:4700:3030::6815:4001"),
		netip.MustParseAddr("2606:4700:3030::6815:5001"),
	}
	predefinedDNS.Put("lagzap.network", cloudflare)
	predefinedDNS.Put("dev.lagzap.network", cloudflare)
	predefinedDNS.Put("alpha.lagzap.network", cloudflare)
	predefinedDNS.Put("beta.lagzap.network", cloudflare)
	predefinedDNS.Put("api.lagzap.network", cloudflare)
	predefinedDNS.Put("geo.lagzap.network", cloudflare)

	return option.Options{
		Log: &option.LogOptions{
			Level:        "trace",
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
				Server:      serverURL,
				AccessToken: accessToken,
			},
			Debug: &option.DebugOptions{
				// 		Listen: "127.0.0.1:1265",
				// 		MemoryLimit: option.MemoryBytes(100 * 1024 * 1024), // 100 MB
			},
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
									"lagzap.network",
									"dev.lagzap.network",
									"alpha.lagzap.network",
									"beta.lagzap.network",
									"api.lagzap.network",
									"geo.lagzap.network",
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
						Type: C.DNSTypeUDP,
						Tag:  "google-udp",
						Options: &option.RemoteDNSServerOptions{
							DNSServerAddressOptions: option.DNSServerAddressOptions{
								Server:     "8.8.8.8",
								ServerPort: 53,
							},
						},
					},
					{
						Type: C.DNSTypeUDP,
						Tag:  "cloudflare-udp",
						Options: &option.RemoteDNSServerOptions{
							DNSServerAddressOptions: option.DNSServerAddressOptions{
								Server:     "1.1.1.1",
								ServerPort: 53,
							},
						},
					},
					{
						Type: C.DNSTypeUDP,
						Tag:  "level3-udp",
						Options: &option.RemoteDNSServerOptions{
							DNSServerAddressOptions: option.DNSServerAddressOptions{
								Server:     "4.2.2.4",
								ServerPort: 53,
							},
						},
					},
					{
						Type: C.DNSTypeTLS,
						Tag:  "google",
						Options: &option.RemoteTLSDNSServerOptions{
							RemoteDNSServerOptions: option.RemoteDNSServerOptions{
								DNSServerAddressOptions: option.DNSServerAddressOptions{
									Server: "8.8.8.8",
								},
								LocalDNSServerOptions: option.LocalDNSServerOptions{
									DialerOptions: option.DialerOptions{
										DomainResolver: &option.DomainResolveOptions{
											Server: "predefined",
										},
									},
								},
							},
						},
					},
				},
				Final: "google",
			},
		},
		Outbounds: []option.Outbound{
			{
				Type:    C.TypeDirect,
				Tag:     "default",
				Options: &option.DirectOutboundOptions{},
			},
			{
				Type:    C.TypeZap,
				Tag:     "zap",
				Options: &option.StubOptions{},
			},
			{
				Type: C.TypeDirect,
				Tag:  "google-direct-resolver",
				Options: &option.DirectOutboundOptions{
					DialerOptions: option.DialerOptions{
						TCPFastOpen:  true,
						TCPMultiPath: true,
						DomainResolver: &option.DomainResolveOptions{
							Strategy:     option.DomainStrategy(C.DomainStrategyPreferIPv4),
							Server:       "google-udp",
							DisableCache: true,
						},
					},
				},
			},
			{
				Type: C.TypeDirect,
				Tag:  "cloudflare-direct-resolver",
				Options: &option.DirectOutboundOptions{
					DialerOptions: option.DialerOptions{
						TCPFastOpen:  true,
						TCPMultiPath: true,
						DomainResolver: &option.DomainResolveOptions{
							Strategy:     option.DomainStrategy(C.DomainStrategyPreferIPv4),
							Server:       "cloudflare-udp",
							DisableCache: true,
						},
					},
				},
			},
			{
				Type: C.TypeDirect,
				Tag:  "level3-direct-resolver",
				Options: &option.DirectOutboundOptions{
					DialerOptions: option.DialerOptions{
						TCPFastOpen:  true,
						TCPMultiPath: true,
						DomainResolver: &option.DomainResolveOptions{
							Strategy:     option.DomainStrategy(C.DomainStrategyPreferIPv4),
							Server:       "level3-udp",
							DisableCache: true,
						},
					},
				},
			},
			{
				Type: C.TypeDirect,
				Tag:  "predefined-direct-resolver",
				Options: &option.DirectOutboundOptions{
					DialerOptions: option.DialerOptions{
						TCPFastOpen:  true,
						TCPMultiPath: true,
						DomainResolver: &option.DomainResolveOptions{
							Strategy:     option.DomainStrategy(C.DomainStrategyPreferIPv4),
							Server:       "predefined",
							DisableCache: true,
						},
					},
				},
			},
		},
		Route: &option.RouteOptions{
			Rules:               []option.Rule{},
			RuleSet:             []option.RuleSet{},
			Final:               "default",
			FindProcess:         true,
			AutoDetectInterface: true,
			DefaultDomainResolver: &option.DomainResolveOptions{
				Server:       "google",
				Strategy:     option.DomainStrategy(C.DomainStrategyIPv4Only),
				DisableCache: true,
			},
			DefaultNetworkType: badoption.Listable[option.InterfaceType]{},
		},
	}
}
