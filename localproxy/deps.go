package localproxy

import "github.com/lagzap/lagzap/adapter"

func BindInterface(coordinator adapter.Coordinator) string {
	if coordinator == nil {
		return ""
	}
	// No probed internet — let the OS pick the default route.
	if !coordinator.HasProbedInternet() {
		return ""
	}
	if iface := coordinator.GetDefaultInterface(); iface != nil {
		return iface.Name
	}
	available := coordinator.GetAvailableInterfaces()
	if len(available) > 0 && available[0] != nil {
		return available[0].Name
	}
	return ""
}
