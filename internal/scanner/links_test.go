package scanner

import (
	"reflect"
	"testing"
)

func TestSelectLinks(t *testing.T) {
	links := []string{
		"https://www.example.com/",            // the page itself
		"https://example.com/about",           // same site without www
		"https://example.com/about#team",      // duplicate once the fragment is dropped
		"https://example.com/blog/a",          //
		"https://example.com/blog/b",          //
		"https://example.com/blog/c",          //
		"https://other.org/page",              // different site
		"https://example.com/files/guide.pdf", // not a page
		"mailto:hi@example.com",
		"https://example.com/contact/",
	}
	got := SelectLinks("https://www.example.com/", links, 4)
	want := []string{
		"https://example.com/about",
		"https://example.com/blog/a",
		"https://example.com/contact/",
		"https://example.com/blog/b",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("SelectLinks = %v, want %v", got, want)
	}
	if n := len(SelectLinks("https://www.example.com/", links, 10)); n != 5 {
		t.Fatalf("expected 5 unique same-site pages, got %d", n)
	}
}

func TestIsPrivateURL(t *testing.T) {
	private := []string{
		"http://localhost:3000/x", "http://app.localhost/", "http://127.0.0.1/", "http://10.1.2.3/",
		"http://192.168.1.1/", "http://172.20.0.5/", "http://169.254.169.254/latest/meta-data",
		"http://[::1]:8080/", "http://0.0.0.0/", "http://100.64.0.1/", "http://[fd00::1]/",
	}
	for _, u := range private {
		if !IsPrivateURL(u) {
			t.Errorf("expected %s to be private", u)
		}
	}
	// Public IPs, including ones whose text merely contains a private-looking fragment.
	public := []string{"http://8.8.8.8/", "http://110.20.30.40/v10.2/127.html", "http://172.15.0.1/", "http://93.184.216.34/?next=localhost"}
	for _, u := range public {
		if IsPrivateURL(u) {
			t.Errorf("expected %s to be public", u)
		}
	}
}
