package localproxy

import "github.com/lagzap/lagzap/adapter"

func BindInterface(coordinator adapter.Coordinator) string {
	if coordinator == nil {
		return ""
	}
	if iface := coordinator.GetDefaultInterface(); iface != nil {
		return iface.Name
	}
	available := coordinator.GetAvailableInterfaces()
	if len(available) > 0 {
		return available[0].Name
	}
	return ""
}
