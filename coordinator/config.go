package coordinator

import (
	"net/netip"
	"time"

	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/option"
	"github.com/lagzap/zap/common/json/badjson"
	"github.com/lagzap/zap/common/json/badoption"
)

func (c *Coordinator) GetOptions() option.Options {
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
			Level:        "trace",
			Timestamp:    true,
			DisableColor: false,
		},
		Lagzap: &option.LagzapOptions{
			Echo: &option.EchoOptions{Enabled: true},
		},
		Experimental: &option.ExperimentalOptions{
			CacheFile: &option.CacheFileOptions{
				Enabled: len(c.cachePath) == 0,
				Path:    c.cachePath,
			},
		},
		DNS: &option.DNSOptions{
			RawDNSOptions: option.RawDNSOptions{
				Rules: []option.DNSRule{
					{
						Type: C.RuleTypeDefault,
						DefaultOptions: option.DefaultDNSRule{
							RawDefaultDNSRule: option.RawDefaultDNSRule{
								Domain: []string{"dns.google", "dns.google.com"},
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
						Type: C.RuleTypeDefault,
						DefaultOptions: option.DefaultDNSRule{
							RawDefaultDNSRule: option.RawDefaultDNSRule{
								DomainSuffix: []string{"youtube.com", "i.ytimg.com", "googlevideo.com", "twitch.tv", "battle.net"},
							},
							DNSRuleAction: option.DNSRuleAction{
								Action: "route",
								RouteOptions: option.DNSRouteActionOptions{
									Server: "google",
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
						Type: C.DNSTypeHosts,
						Tag:  "predefined",
						Options: &option.HostsDNSServerOptions{
							Predefined: predefinedDNS,
						},
					},
				},
				Final: "google-udp",
			},
		},
		Outbounds: []option.Outbound{
			{
				Type: C.TypeDirect,
				Tag:  "direct",
			},
		},
		Route: &option.RouteOptions{
			Rules: []option.Rule{
				{
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
					Type: C.RuleTypeDefault,
					DefaultOptions: option.DefaultRule{
						RawDefaultRule: option.RawDefaultRule{
							Protocol:          []string{"tls"},
							Port:              []uint16{53},
							SourceIPIsPrivate: true,
						},
						RuleAction: option.RuleAction{
							Action: "route",
							RouteOptions: option.RouteActionOptions{
								Outbound: "global",
							},
						},
					},
				},
				{
					Type: C.RuleTypeDefault,
					DefaultOptions: option.DefaultRule{
						RawDefaultRule: option.RawDefaultRule{
							Protocol:          []string{"dns"},
							Port:              []uint16{53},
							SourceIPIsPrivate: true,
						},
						RuleAction: option.RuleAction{Action: "hijack-dns"},
					},
				},
				{
					Type: C.RuleTypeDefault,
					DefaultOptions: option.DefaultRule{
						RuleAction: option.RuleAction{
							Action: "resolve",
							ResolveOptions: option.RouteActionResolve{
								Server:   "predefined",
								Strategy: option.DomainStrategy(C.DomainStrategyPreferIPv4),
							},
						},
						RawDefaultRule: option.RawDefaultRule{},
					},
				},
				{
					Type: C.RuleTypeDefault,
					DefaultOptions: option.DefaultRule{
						RawDefaultRule: option.RawDefaultRule{
							DomainSuffix: []string{"lagzap.network"},
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
			RuleSet: []option.RuleSet{},
			Final:   "direct",
			GeoIP: &option.GeoIPOptions{
				DownloadDetour: "direct",
				DownloadURL:    "https://geo.lagzap.network/geoip.db",
			},
			FindProcess:         true,
			AutoDetectInterface: true,
			DefaultDomainResolver: &option.DomainResolveOptions{
				Server: "google-udp",
			},
			DefaultNetworkType: badoption.Listable[option.InterfaceType]{},
		},
	}
}

// func (c *Coordinator) configure(configMsg InitialConfig) (option.Options, error) {
// 	predefinedDNS := &badjson.TypedMap[string, badoption.Listable[netip.Addr]]{}
// 	predefinedDNS.Put("dns.google", []netip.Addr{
// 		netip.MustParseAddr("8.8.8.8"),
// 		netip.MustParseAddr("8.8.4.4"),
// 		netip.MustParseAddr("2001:4860:4860::8844"),
// 		netip.MustParseAddr("2001:4860:4860::8888"),
// 	})
// 	predefinedDNS.Put("dns.google.com", []netip.Addr{
// 		netip.MustParseAddr("8.8.8.8"),
// 		netip.MustParseAddr("8.8.4.4"),
// 		netip.MustParseAddr("2001:4860:4860::8844"),
// 		netip.MustParseAddr("2001:4860:4860::8888"),
// 	})

// 	options := option.Options{
// 		Log: &option.LogOptions{
// 			Level:        "trace",
// 			Timestamp:    true,
// 			DisableColor: false,
// 		},
// 		Lagzap: &option.LagzapOptions{
// 			Echo: &option.EchoOptions{Enabled: true},
// 		},
// 		Experimental: &option.ExperimentalOptions{
// 			CacheFile: &option.CacheFileOptions{
// 				Enabled: len(c.cachePath) == 0,
// 				Path:    c.cachePath,
// 			},
// 		},
// 		DNS: &option.DNSOptions{
// 			RawDNSOptions: option.RawDNSOptions{
// 				Rules: []option.DNSRule{
// 					{
// 						Type: C.RuleTypeDefault,
// 						DefaultOptions: option.DefaultDNSRule{
// 							RawDefaultDNSRule: option.RawDefaultDNSRule{
// 								Domain: []string{"dns.google", "dns.google.com"},
// 							},
// 							DNSRuleAction: option.DNSRuleAction{
// 								Action: "route",
// 								RouteOptions: option.DNSRouteActionOptions{
// 									Server: "predefined",
// 								},
// 							},
// 						},
// 					},
// 					{
// 						Type: C.RuleTypeDefault,
// 						DefaultOptions: option.DefaultDNSRule{
// 							RawDefaultDNSRule: option.RawDefaultDNSRule{
// 								DomainSuffix: []string{"youtube.com", "i.ytimg.com", "googlevideo.com", "twitch.tv", "battle.net"},
// 							},
// 							DNSRuleAction: option.DNSRuleAction{
// 								Action: "route",
// 								RouteOptions: option.DNSRouteActionOptions{
// 									Server: "google",
// 								},
// 							},
// 						},
// 					},
// 				},
// 				Servers: []option.DNSServerOptions{
// 					{
// 						Type: C.DNSTypeLocal,
// 						Tag:  "local",
// 					},
// 					{
// 						Type: C.DNSTypeTLS,
// 						Tag:  "google",
// 						Options: &option.RemoteTLSDNSServerOptions{
// 							RemoteDNSServerOptions: option.RemoteDNSServerOptions{
// 								DNSServerAddressOptions: option.DNSServerAddressOptions{
// 									Server: "8.8.8.8",
// 								},
// 								LocalDNSServerOptions: option.LocalDNSServerOptions{
// 									DialerOptions: option.DialerOptions{
// 										DomainResolver: &option.DomainResolveOptions{
// 											Server: "predefined",
// 										},
// 									},
// 								},
// 							},
// 						},
// 					},
// 					{
// 						Type: C.DNSTypeUDP,
// 						Tag:  "google-udp",
// 						Options: &option.RemoteDNSServerOptions{
// 							DNSServerAddressOptions: option.DNSServerAddressOptions{
// 								Server:     "8.8.8.8",
// 								ServerPort: 53,
// 							},
// 						},
// 					},
// 					{
// 						Type: C.DNSTypeHosts,
// 						Tag:  "predefined",
// 						Options: &option.HostsDNSServerOptions{
// 							Predefined: predefinedDNS,
// 						},
// 					},
// 				},
// 				Final: "google-udp",
// 			},
// 		},
// 	}

// 	var outbounds []option.Outbound
// 	outbounds = append(outbounds, option.Outbound{
// 		Type: C.TypeDirect,
// 		Tag:  "direct",
// 	})
// 	countryMap := make(map[string]bool)
// 	routerOutboundTags := make([]string, 0, len(configMsg.Nodes))
// 	outboundTags := make([]string, 0, len(configMsg.Nodes))
// 	countryOutboundTags := make(map[string][]string)

// 	for tag, node := range configMsg.Nodes {
// 		if !countryMap[node.Country] {
// 			countryMap[node.Country] = true
// 		}
// 		if node.EdgePort == nil {
// 			continue
// 		}

// 		tag := fmt.Sprintf("edge-%s", tag)
// 		outbounds = append(outbounds, option.Outbound{
// 			Type: C.TypeZap,
// 			Tag:  tag,
// 			Options: &option.ZapOutboundOptions{
// 				ServerOptions: option.ServerOptions{
// 					Server:     node.IPv4,
// 					ServerPort: *node.EdgePort,
// 				},
// 			},
// 		})

// 		routerOutboundTags = append(routerOutboundTags, tag)
// 	}
// 	for tag, node := range configMsg.Nodes {
// 		if node.RelayPort == nil {
// 			continue
// 		}
// 		outbounds = append(outbounds, option.Outbound{
// 			Type: C.TypeMultizap,
// 			Tag:  tag,
// 			Options: &option.MultizapOutboundOptions{
// 				EchoPort:       node.EchoPort,
// 				Outbounds:      routerOutboundTags,
// 				Interval:       badoption.Duration(time.Second * 1),
// 				IdleTimeout:    badoption.Duration(time.Second * 20),
// 				Tolerance:      50,
// 				UserID:         configMsg.User.ID.String(),
// 				SessionID:      configMsg.User.SessionID.String(),
// 				UdpConnections: configMsg.User.UdpConnection,
// 				ServerOptions: option.ServerOptions{
// 					Server:     node.IPv4,
// 					ServerPort: *node.RelayPort,
// 				},
// 			},
// 		})

// 		outboundTags = append(outboundTags, tag)
// 		countryOutboundTags[node.Country] = append(countryOutboundTags[node.Country], tag)
// 	}

// 	if len(outboundTags) > 0 {
// 		for country := range countryMap {
// 			outboundTags := countryOutboundTags[country]
// 			outbounds = append(outbounds, option.Outbound{
// 				Type: C.TypeSelector,
// 				Tag:  country,
// 				Options: &option.SelectorOutboundOptions{
// 					Default:   outboundTags[0],
// 					Outbounds: outboundTags,
// 				},
// 			})
// 		}
// 	}

// 	regionMap := make(map[string]bool)
// 	regionOutboundTags := make(map[string][]string)
// 	for _, region := range configMsg.Regions {
// 		regionMap[region.Tag] = true
// 	}
// 	for _, node := range configMsg.Nodes {
// 		if regionMap[node.Region] {
// 			regionOutboundTags[node.Region] = append(regionOutboundTags[node.Region], node.ID)
// 		}
// 	}
// 	for region, outboundTags := range regionOutboundTags {
// 		outbounds = append(outbounds, option.Outbound{
// 			Type: C.TypeSelector,
// 			Tag:  region,
// 			Options: &option.SelectorOutboundOptions{
// 				Default:   outboundTags[0],
// 				Outbounds: outboundTags,
// 			},
// 		})
// 	}

// 	if len(outboundTags) > 0 {
// 		outbounds = append(outbounds, option.Outbound{
// 			Type: C.TypeSelector,
// 			Tag:  "global",
// 			Options: &option.SelectorOutboundOptions{
// 				Default:   outboundTags[0],
// 				Outbounds: outboundTags,
// 			},
// 		})
// 		for _, title := range configMsg.Titles {
// 			for _, profile := range title.Profiles {
// 				outbounds = append(outbounds, option.Outbound{
// 					Type: C.TypeSelector,
// 					Tag:  fmt.Sprintf("profile-%s", profile.ID),
// 					Options: &option.SelectorOutboundOptions{
// 						Default:   outboundTags[0],
// 						Outbounds: outboundTags,
// 					},
// 				})
// 			}
// 		}
// 	}
// 	options.Outbounds = outbounds

// 	rules := []option.Rule{
// 		{
// 			Type: C.RuleTypeDefault,
// 			DefaultOptions: option.DefaultRule{
// 				RuleAction: option.RuleAction{
// 					Action: "sniff",
// 					SniffOptions: option.RouteActionSniff{
// 						Sniffer: []string{
// 							"http",
// 							"tls",
// 							"dns",
// 							"dtls",
// 						},
// 						Timeout: badoption.Duration(time.Second),
// 					},
// 				},
// 				RawDefaultRule: option.RawDefaultRule{},
// 			},
// 		},
// 		{
// 			Type: C.RuleTypeDefault,
// 			DefaultOptions: option.DefaultRule{
// 				RawDefaultRule: option.RawDefaultRule{
// 					Protocol:          []string{"tls"},
// 					Port:              []uint16{53},
// 					SourceIPIsPrivate: true,
// 				},
// 				RuleAction: option.RuleAction{
// 					Action: "route",
// 					RouteOptions: option.RouteActionOptions{
// 						Outbound: "global",
// 					},
// 				},
// 			},
// 		},
// 		{
// 			Type: C.RuleTypeDefault,
// 			DefaultOptions: option.DefaultRule{
// 				RawDefaultRule: option.RawDefaultRule{
// 					Protocol:          []string{"dns"},
// 					Port:              []uint16{53},
// 					SourceIPIsPrivate: true,
// 				},
// 				RuleAction: option.RuleAction{Action: "hijack-dns"},
// 			},
// 		},
// 		{
// 			Type: C.RuleTypeDefault,
// 			DefaultOptions: option.DefaultRule{
// 				RuleAction: option.RuleAction{
// 					Action: "resolve",
// 					ResolveOptions: option.RouteActionResolve{
// 						Server:   "predefined",
// 						Strategy: option.DomainStrategy(C.DomainStrategyPreferIPv4),
// 					},
// 				},
// 				RawDefaultRule: option.RawDefaultRule{},
// 			},
// 		},
// 		{
// 			Type: C.RuleTypeDefault,
// 			DefaultOptions: option.DefaultRule{
// 				RawDefaultRule: option.RawDefaultRule{
// 					DomainSuffix: []string{"lagzap.network"},
// 				},
// 				RuleAction: option.RuleAction{
// 					Action: "route",
// 					RouteOptions: option.RouteActionOptions{
// 						Outbound: "direct",
// 					},
// 				},
// 			},
// 		},
// 	}

// 	var ruleSet []option.RuleSet

// 	for _, rs := range configMsg.RuleSet {
// 		ruleSet = append(ruleSet, option.RuleSet{
// 			Type:   C.RuleSetTypeRemote,
// 			Tag:    rs.Tag,
// 			Format: "binary",
// 			RemoteOptions: option.RemoteRuleSet{
// 				URL:            rs.URL,
// 				DownloadDetour: "direct",
// 			},
// 		})
// 	}

// 	options.Route = &option.RouteOptions{
// 		Rules:   rules,
// 		RuleSet: ruleSet,
// 		Final:   "direct",
// 		GeoIP: &option.GeoIPOptions{
// 			DownloadDetour: "direct",
// 			DownloadURL:    "https://geo.lagzap.network/geoip.db",
// 		},
// 		FindProcess:         true,
// 		AutoDetectInterface: true,
// 		DefaultDomainResolver: &option.DomainResolveOptions{
// 			Server: "google-udp",
// 		},
// 		DefaultNetworkType: badoption.Listable[option.InterfaceType]{},
// 	}

// 	return options, nil
// }
