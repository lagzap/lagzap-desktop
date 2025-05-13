package main

import (
	"fmt"
	"net/netip"
	"os"
	"time"

	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/option"
	"github.com/lagzap/zap/common/json/badjson"
	"github.com/lagzap/zap/common/json/badoption"
)

type Region struct {
	Tag    string `json:"tag"`
	Name   string `json:"name"`
	Host   string `json:"host"`
	Active bool   `json:"active"`
}

type Node struct {
	ID        string  `json:"id"`
	Region    string  `json:"region"`
	Area      string  `json:"area"`
	Name      string  `json:"name"`
	Country   string  `json:"country"`
	City      string  `json:"city"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	IPv4      string  `json:"ipv4"`
	IPv6      *string `json:"ipv6,omitempty"`
}

type HeadlessRule struct {
	Tag            string        `json:"tag"`
	URL            string        `json:"url"`
	UpdateInterval time.Duration `json:"update_interval"`
}

func createConfig(
	logLevel string,
	regions []Region,
	nodes []Node,
	headlessRules []HeadlessRule,
) (option.Options, error) {
	cachePath, cachePathErr := os.UserCacheDir()
	_ = os.Mkdir(cachePath+"\\LagZap", os.ModePerm)
	cachePath += "\\LagZap\\cache.db"

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

	options := option.Options{
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
				Enabled: cachePathErr == nil,
				Path:    cachePath,
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
	}

	var outbounds []option.Outbound
	outbounds = append(outbounds, option.Outbound{
		Type: C.TypeDirect,
		Tag:  "direct",
	})
	countryMap := make(map[string]bool)
	routerOutboundTags := make([]string, 0, len(nodes))
	outboundTags := make([]string, 0, len(nodes))
	countryOutboundTags := make(map[string][]string)

	for _, node := range nodes {
		if !countryMap[node.Country] {
			countryMap[node.Country] = true
		}

		tag := fmt.Sprintf("route-%s", node.ID)
		outbounds = append(outbounds, option.Outbound{
			Type: C.TypeZap,
			Tag:  tag,
			Options: &option.ZapOutboundOptions{
				ServerOptions: option.ServerOptions{
					Server:     node.IPv4,
					ServerPort: 60000,
				},
			},
		})

		routerOutboundTags = append(routerOutboundTags, tag)
	}
	for _, node := range nodes {
		tag := node.ID
		outbounds = append(outbounds, option.Outbound{
			Type: C.TypeMultizap,
			Tag:  tag,
			Options: &option.MultizapOutboundOptions{
				EchoPort:       9090,
				Outbounds:      routerOutboundTags,
				Interval:       badoption.Duration(time.Second * 1),
				IdleTimeout:    badoption.Duration(time.Second * 20),
				Tolerance:      50,
				UserID:         "14eb542a-7336-4e02-af7c-70c838baf580",
				SessionID:      "e0c1d4f2-3a5b-4f8b-9a6c-7d5e0f3b8c1d",
				UdpConnections: 2,
				ServerOptions: option.ServerOptions{
					Server:     node.IPv4,
					ServerPort: 60000,
				},
			},
		})

		outboundTags = append(outboundTags, tag)
		countryOutboundTags[node.Country] = append(countryOutboundTags[node.Country], tag)
	}

	countries := make([]string, 0, len(countryMap))
	for country := range countryMap {
		countries = append(countries, country)
		outboundTags := countryOutboundTags[country]

		outbounds = append(outbounds, option.Outbound{
			Type: C.TypeSelector,
			Tag:  country,
			Options: &option.SelectorOutboundOptions{
				Default:   outboundTags[0],
				Outbounds: outboundTags,
			},
		})
	}

	regionMap := make(map[string]bool)
	regionOutboundTags := make(map[string][]string)
	for _, region := range regions {
		regionMap[region.Tag] = true
	}
	for _, node := range nodes {
		if regionMap[node.Region] {
			regionOutboundTags[node.Region] = append(regionOutboundTags[node.Region], node.ID)
		}
	}
	for region, outboundTags := range regionOutboundTags {
		outbounds = append(outbounds, option.Outbound{
			Type: C.TypeSelector,
			Tag:  region,
			Options: &option.SelectorOutboundOptions{
				Default:   outboundTags[0],
				Outbounds: outboundTags,
			},
		})
	}

	outbounds = append(outbounds, option.Outbound{
		Type: C.TypeSelector,
		Tag:  "global",
		Options: &option.SelectorOutboundOptions{
			Default:   outboundTags[0],
			Outbounds: outboundTags,
		},
	})
	options.Outbounds = outbounds

	rules := []option.Rule{
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
					Protocol: []string{"tls"},
					Port:     []uint16{53},
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
					Protocol: []string{"dns"},
					// Port:              []uint16{53},
					// SourceIPIsPrivate: true,
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
		{
			Type: C.RuleTypeDefault,
			DefaultOptions: option.DefaultRule{
				RawDefaultRule: option.RawDefaultRule{
					DomainSuffix:     []string{"blizzard.com"},
					ProcessPathRegex: []string{".*\\\\Battle\\.net\\\\Agent\\\\Agent\\.\\d+\\\\Agent\\.exe$"},
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
					DomainSuffix:     []string{"xboxlive.com"},
					ProcessPathRegex: []string{"^C:\\\\Program Files\\\\WindowsApps\\\\Microsoft\\.Gaming.*"},
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
					DomainSuffix: []string{"twitch.tv", "youtube.com"},
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
					ProcessPathRegex: []string{".*\\\\Telegram Desktop\\\\Telegram\\.exe$"},
					IPCIDR: []string{
						"149.154.160.0/22",
						"149.154.160.0/23",
						"149.154.162.0/23",
						"149.154.164.0/22",
						"149.154.164.0/23",
						"149.154.166.0/23",
						"91.108.4.0/22",
						"91.108.56.0/22",
						"91.108.8.0/22",
						"95.161.64.0/20",
					},
					Port: []uint16{443},
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
					Port: []uint16{1119},
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
					ProcessName: []string{"firefox.exe"},
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
					IPCIDR: []string{
						"34.0.0.0/8", "35.0.0.0/8",
					},
				},
				RuleAction: option.RuleAction{
					Action: "route",
					RouteOptions: option.RouteActionOptions{
						Outbound: "global",
					},
				},
			},
		},
	}

	var ruleSet []option.RuleSet

	for _, rs := range headlessRules {
		ruleSet = append(ruleSet, option.RuleSet{
			Type:   C.RuleSetTypeRemote,
			Tag:    rs.Tag,
			Format: "binary",
			RemoteOptions: option.RemoteRuleSet{
				URL:            rs.URL,
				DownloadDetour: "direct",
			},
		})
	}

	options.Route = &option.RouteOptions{
		Rules:   rules,
		RuleSet: ruleSet,
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
	}

	return options, nil
}
