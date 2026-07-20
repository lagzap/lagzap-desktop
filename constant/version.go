package constant

var Version = "unknown"

// DevBuild is set to "true" via ldflags for wails dev backend builds.
var DevBuild = ""

func IsDevBuild() bool {
	return DevBuild == "true"
}
