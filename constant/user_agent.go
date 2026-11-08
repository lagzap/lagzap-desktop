package constant

func UserAgent() string {
	v := SemVer()
	if v == "0.0.0-dev" {
		return "LagZap-Desktop/dev"
	}
	return "LagZap-Desktop/" + v
}
