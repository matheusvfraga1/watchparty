// Watch Party para Windows: abre o app numa janela própria (Edge, Chrome ou Brave em modo app).
package main

import (
	"os"
	"os/exec"
	"path/filepath"
)

const version = "1"
const appURL = "https://watchparty-i5yl.onrender.com/?source=win&v=" + version

func findBrowser() string {
	pf, pf86, la := os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")
	for _, p := range []string{
		filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(la, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf, `BraveSoftware\Brave-Browser\Application\brave.exe`),
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func main() {
	if b := findBrowser(); b != "" {
		if exec.Command(b, "--app="+appURL, "--start-maximized").Start() == nil {
			return
		}
	}
	exec.Command("rundll32", "url.dll,FileProtocolHandler", appURL).Start()
}
