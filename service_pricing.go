package main

import (
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/lagzap/lagzap-desktop/constant"
	"github.com/lagzap/lagzap/adapter"
)

// Plans for sale and their quotes, from the coordinator. The app never
// computes a price; Buy opens the website's checkout with the exact choice.

// defaultSiteURL is the website that takes payment. LAGZAP_SITE_URL points a
// build at staging.
const defaultSiteURL = "https://lagzap.com"

func siteURL() string {
	if v := strings.TrimSpace(os.Getenv("LAGZAP_SITE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return defaultSiteURL
}

func pricingNotReady() *adapter.PricingError {
	return &adapter.PricingError{Code: adapter.PricingErrorUnreachable, Message: adapter.PricingErrorUnreachable}
}

func (s *Service) pricingClient() adapter.PricingClient {
	if s.coordinator == nil {
		return nil
	}
	client, _ := s.coordinator.(adapter.PricingClient)
	return client
}

// PricingPlans lists the plans for sale in currency ("" for the server's
// first currency).
func (s *Service) PricingPlans(currency string) adapter.PricingPlansResult {
	if c := s.pricingClient(); c != nil {
		return c.PricingPlans(currency)
	}
	return adapter.PricingPlansResult{Error: pricingNotReady()}
}

// Quote prices one choice.
func (s *Service) Quote(req adapter.QuoteRequest) adapter.QuoteResult {
	if c := s.pricingClient(); c != nil {
		return c.Quote(req)
	}
	return adapter.QuoteResult{Error: pricingNotReady()}
}

// CheckoutURL is the website's checkout for a choice; options are the ones
// the user changed from their included value. upgrade: the user moves up
// from their current plan and pays the difference.
func (s *Service) CheckoutURL(planID int64, period int, currency string, options map[string]int64, upgrade bool) string {
	upgradeURL := ""
	if access := s.GetPlanAccess(); access != nil {
		upgradeURL = access.UpgradeURL
	}
	return checkoutURL(siteURL(), upgradeURL, planID, period, currency, options, upgrade, constant.SemVer())
}

// checkoutURL builds <site>/checkout?plan=..&period=..&currency=..&o.<option>=..[&upgrade=1]&src=app&v=..
// When the server's upgrade_url names another host, that host is used.
func checkoutURL(site, upgradeURL string, planID int64, period int, currency string, options map[string]int64, upgrade bool, version string) string {
	base, err := url.Parse(site)
	if err != nil || base.Host == "" {
		base, _ = url.Parse(defaultSiteURL)
	}
	if u, err := url.Parse(strings.TrimSpace(upgradeURL)); err == nil && u.Host != "" && u.Host != base.Host {
		base = &url.URL{Scheme: u.Scheme, Host: u.Host}
		if base.Scheme == "" {
			base.Scheme = "https"
		}
	}
	q := url.Values{}
	q.Set("plan", strconv.FormatInt(planID, 10))
	q.Set("period", strconv.Itoa(period))
	q.Set("currency", currency)
	names := make([]string, 0, len(options))
	for name := range options {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		q.Set("o."+name, strconv.FormatInt(options[name], 10))
	}
	if upgrade {
		q.Set("upgrade", "1")
	}
	q.Set("src", "app")
	q.Set("v", version)
	return (&url.URL{Scheme: base.Scheme, Host: base.Host, Path: "/checkout", RawQuery: q.Encode()}).String()
}
