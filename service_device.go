package main

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"runtime"

	"github.com/jaypipes/ghw"
	"github.com/lagzap/lagzap-desktop/constant"
	"golang.org/x/sys/windows/registry"
)

func (s *Service) DeviceHash() string {
	info, err := ghw.CPU()
	if err != nil {
		return ""
	}
	bios, err := ghw.BIOS()
	if err != nil {
		return ""
	}
	base, err := ghw.Baseboard()
	if err != nil {
		return ""
	}
	Block, err := ghw.Block()
	if err != nil {
		return ""
	}
	gpu, err := ghw.GPU()
	if err != nil {
		return ""
	}
	data := Block.String() + base.String() + bios.String() + info.String() + gpu.String()
	hash := md5Hash(data)
	s.deviceHash = hash
	return hash
}

func (s *Service) DeviceInfo() string {
	info := make(map[string]interface{})
	cpu, err := ghw.CPU()
	if err == nil {
		info["cpu"] = cpu.String()
	}
	base, err := ghw.Baseboard()
	if err == nil {
		info["baseboard"] = base.String()
	}
	gpu, err := ghw.GPU()
	if err == nil {
		info["gpu"] = gpu.String()
	}
	mem, err := ghw.Memory()
	if err == nil {
		info["memory"] = mem.String()
	}

	info["os"] = runtime.GOOS
	info["arch"] = runtime.GOARCH

	info["app_version"] = constant.Version
	info["client_version"] = constant.Version

	if runtime.GOOS == "windows" {
		winInfo := make(map[string]string)
		k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
		if err == nil {
			defer k.Close()
			productName, _, _ := k.GetStringValue("ProductName")
			releaseId, _, _ := k.GetStringValue("ReleaseId")
			currentBuild, _, _ := k.GetStringValue("CurrentBuild")
			displayVersion, _, _ := k.GetStringValue("DisplayVersion")
			winInfo["ProductName"] = productName
			winInfo["ReleaseId"] = releaseId
			winInfo["CurrentBuild"] = currentBuild
			winInfo["DisplayVersion"] = displayVersion
			info["windows"] = winInfo
		}
	}

	data, err := json.Marshal(info)
	if err != nil {
		return "{}"
	}
	return string(data)
}


func md5Hash(data string) string {
	hash := md5.New()
	hash.Write([]byte(data))
	return hex.EncodeToString(hash.Sum(nil))
}
