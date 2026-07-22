package constant

func UserAgent() string {
	v := SemVer()
	if v == "0.0.0-dev" {
		return "Cyrex-Desktop/dev"
	}
	return "Cyrex-Desktop/" + v
}
