package scanner

import (
	neturl "net/url"
	"path"
	"strings"
)

// nonPageExt lists link targets that are files rather than scannable pages.
var nonPageExt = map[string]bool{
	".pdf": true, ".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".svg": true,
	".webp": true, ".ico": true, ".zip": true, ".gz": true, ".tar": true, ".rar": true,
	".mp3": true, ".mp4": true, ".avi": true, ".mov": true, ".webm": true, ".wav": true,
	".doc": true, ".docx": true, ".xls": true, ".xlsx": true, ".ppt": true, ".pptx": true,
	".csv": true, ".xml": true, ".json": true, ".css": true, ".js": true, ".exe": true, ".dmg": true,
}

func siteHost(u *neturl.URL) string {
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
}

// SelectLinks picks up to max pages worth scanning from the links found on a page.
// It keeps pages on the same site only, drops duplicates, fragments, the page
// itself and file downloads, then spreads the selection across the site's
// top-level sections so one section (e.g. /blog/...) cannot fill every slot.
func SelectLinks(pageURL string, links []string, max int) []string {
	base, err := neturl.Parse(pageURL)
	if err != nil || max <= 0 {
		return nil
	}
	key := func(u *neturl.URL) string {
		p := strings.TrimSuffix(u.Path, "/")
		return siteHost(u) + p + "?" + u.RawQuery
	}
	seen := map[string]bool{key(base): true}

	var sections []string
	bySection := map[string][]string{}
	for _, link := range links {
		u, err := neturl.Parse(link)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			continue
		}
		if siteHost(u) != siteHost(base) || u.Port() != base.Port() {
			continue
		}
		if nonPageExt[strings.ToLower(path.Ext(u.Path))] {
			continue
		}
		u.Fragment = ""
		k := key(u)
		if seen[k] {
			continue
		}
		seen[k] = true

		section := ""
		if parts := strings.Split(strings.Trim(u.Path, "/"), "/"); len(parts) > 1 {
			section = parts[0]
		} else {
			// Top-level pages are each their own section.
			section = "/" + k
		}
		if _, ok := bySection[section]; !ok {
			sections = append(sections, section)
		}
		bySection[section] = append(bySection[section], u.String())
	}

	out := make([]string, 0, max)
	for round := 0; len(out) < max; round++ {
		added := false
		for _, s := range sections {
			if round < len(bySection[s]) {
				out = append(out, bySection[s][round])
				added = true
				if len(out) == max {
					break
				}
			}
		}
		if !added {
			break
		}
	}
	return out
}
