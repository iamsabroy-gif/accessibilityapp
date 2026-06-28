package coverage

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Entry is one WCAG success criterion from the coverage report.
type Entry struct {
	SC                   string `json:"sc"`
	Title                string `json:"title"`
	Level                string `json:"level"`
	Status               string `json:"status"`
	PreviousStatus       string `json:"previous_status,omitempty"`
	Techniques           string `json:"techniques,omitempty"`
	ImplementationDetail string `json:"implementation_detail,omitempty"`
	CodeLocation         string `json:"code_location,omitempty"`
}

type Report struct {
	Title          string    `json:"title"`
	Subtitle       string    `json:"subtitle,omitempty"`
	Filename       string    `json:"filename"`
	UpdatedAt      time.Time `json:"updated_at"`
	Entries        []Entry   `json:"entries"`
	Implemented    int       `json:"implemented"`
	Partial        int       `json:"partial"`
	NotImplemented int       `json:"not_implemented"`
}

// Store safely serves and replaces the current report.
type Store struct {
	mu     sync.RWMutex
	path   string
	report *Report
}

func NewStore(path string) *Store {
	s := &Store{path: path}
	if report, err := ParseFile(path); err == nil {
		s.report = report
	}
	return s
}

func (s *Store) Get() (*Report, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.report == nil {
		return nil, false
	}
	copyReport := *s.report
	copyReport.Entries = append([]Entry(nil), s.report.Entries...)
	return &copyReport, true
}

func (s *Store) Replace(data []byte, filename string) (*Report, error) {
	report, err := Parse(data, filename)
	if err != nil {
		return nil, err
	}
	if s.path != "" {
		if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil && filepath.Dir(s.path) != "." {
			return nil, err
		}
		tmp := s.path + ".tmp"
		if err := os.WriteFile(tmp, data, 0o644); err != nil {
			return nil, err
		}
		if err := os.Rename(tmp, s.path); err != nil {
			return nil, err
		}
	}
	s.mu.Lock()
	s.report = report
	s.mu.Unlock()
	return report, nil
}

func ParseFile(path string) (*Report, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Parse(data, filepath.Base(path))
}

type worksheet struct {
	Rows []row `xml:"sheetData>row"`
}
type row struct {
	Cells []cell `xml:"c"`
}
type cell struct {
	Ref    string `xml:"r,attr"`
	Type   string `xml:"t,attr"`
	Value  string `xml:"v"`
	Inline string `xml:"is>t"`
}
type sharedStrings struct {
	Items []struct {
		Text string `xml:"t"`
	} `xml:"si"`
}

var columnPattern = regexp.MustCompile(`^[A-Z]+`)

func Parse(data []byte, filename string) (*Report, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("invalid XLSX file: %w", err)
	}
	files := make(map[string]*zip.File, len(zr.File))
	for _, file := range zr.File {
		files[file.Name] = file
	}
	sheetFile := files["xl/worksheets/sheet1.xml"]
	if sheetFile == nil {
		return nil, fmt.Errorf("XLSX is missing the first worksheet")
	}

	shared := []string{}
	if f := files["xl/sharedStrings.xml"]; f != nil {
		var values sharedStrings
		if err := decodeXML(f, &values); err != nil {
			return nil, err
		}
		for _, item := range values.Items {
			shared = append(shared, item.Text)
		}
	}
	var sheet worksheet
	if err := decodeXML(sheetFile, &sheet); err != nil {
		return nil, err
	}
	value := func(c cell) string {
		if c.Type == "inlineStr" {
			return strings.TrimSpace(c.Inline)
		}
		if c.Type == "s" {
			i, _ := strconv.Atoi(c.Value)
			if i >= 0 && i < len(shared) {
				return strings.TrimSpace(shared[i])
			}
		}
		return strings.TrimSpace(c.Value)
	}
	rows := make([]map[string]string, 0, len(sheet.Rows))
	for _, sourceRow := range sheet.Rows {
		values := map[string]string{}
		for _, c := range sourceRow.Cells {
			values[columnPattern.FindString(c.Ref)] = value(c)
		}
		rows = append(rows, values)
	}

	if len(rows) < 2 {
		return nil, fmt.Errorf("coverage report is empty")
	}

	report := &Report{
		Title:    rows[0]["A"],
		Filename: filepath.Base(filename),
	}
	if len(rows) > 1 {
		report.Subtitle = rows[1]["A"]
	}
	report.UpdatedAt = time.Now().UTC()

	headerRow := -1
	for i, r := range rows {
		if strings.EqualFold(r["A"], "SC") {
			headerRow = i
			break
		}
	}
	if headerRow < 0 || headerRow >= len(rows)-1 {
		return nil, fmt.Errorf("could not find header row with 'SC' column")
	}

	headers := rows[headerRow]
	colMap := map[string]string{}
	for col, val := range headers {
		switch strings.ToLower(strings.TrimSpace(val)) {
		case "sc":
			colMap["sc"] = col
		case "title", "criterion":
			colMap["title"] = col
		case "level":
			colMap["level"] = col
		case "status":
			colMap["status"] = col
		case "previous status", "previous_status":
			colMap["previous_status"] = col
		case "techniques", "rules / checks", "rules/checks", "rules":
			colMap["techniques"] = col
		case "implementation notes", "implementation detail", "implementation_detail", "notes":
			colMap["implementation_detail"] = col
		case "code location", "code_location":
			colMap["code_location"] = col
		}
	}

	if colMap["sc"] == "" {
		return nil, fmt.Errorf("SC column not found in header row")
	}

	for _, values := range rows[headerRow+1:] {
		sc := values[colMap["sc"]]
		if sc == "" {
			continue
		}

		status := values[colMap["status"]]
		level := values[colMap["level"]]
		title := values[colMap["title"]]
		if title == "" {
			title = wcagTitles[sc]
		}

		entry := Entry{
			SC:                   sc,
			Title:                title,
			Level:                level,
			Status:               normalizeStatus(status),
			PreviousStatus:       values[colMap["previous_status"]],
			Techniques:           values[colMap["techniques"]],
			ImplementationDetail: values[colMap["implementation_detail"]],
			CodeLocation:         values[colMap["code_location"]],
		}
		report.Entries = append(report.Entries, entry)

		switch strings.ToLower(entry.Status) {
		case "implemented":
			report.Implemented++
		case "partially implemented", "partial":
			report.Partial++
		case "not implemented":
			report.NotImplemented++
		}
	}

	if len(report.Entries) == 0 {
		return nil, fmt.Errorf("coverage report contains no WCAG entries")
	}
	return report, nil
}

func normalizeStatus(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "implemented":
		return "Implemented"
	case "partial", "partially implemented":
		return "Partially Implemented"
	case "not implemented", "missing":
		return "Not Implemented"
	default:
		return s
	}
}

func decodeXML(file *zip.File, target any) error {
	r, err := file.Open()
	if err != nil {
		return err
	}
	defer r.Close()
	if err := xml.NewDecoder(io.LimitReader(r, 10<<20)).Decode(target); err != nil {
		return fmt.Errorf("invalid worksheet XML: %w", err)
	}
	return nil
}

var wcagTitles = map[string]string{
	"1.1.1":  "Non-text Content",
	"1.2.1":  "Audio-only and Video-only (Prerecorded)",
	"1.2.2":  "Captions (Prerecorded)",
	"1.2.3":  "Audio Description or Media Alternative (Prerecorded)",
	"1.2.4":  "Captions (Live)",
	"1.2.5":  "Audio Description (Prerecorded)",
	"1.3.1":  "Info and Relationships",
	"1.3.2":  "Meaningful Sequence",
	"1.3.3":  "Sensory Characteristics",
	"1.3.4":  "Orientation",
	"1.3.5":  "Identify Input Purpose",
	"1.4.1":  "Use of Color",
	"1.4.2":  "Audio Control",
	"1.4.3":  "Contrast (Minimum)",
	"1.4.4":  "Resize Text",
	"1.4.5":  "Images of Text",
	"1.4.10": "Reflow",
	"1.4.11": "Non-text Contrast",
	"1.4.12": "Text Spacing",
	"1.4.13": "Content on Hover or Focus",
	"2.1.1":  "Keyboard",
	"2.1.2":  "No Keyboard Trap",
	"2.1.4":  "Character Key Shortcuts",
	"2.2.1":  "Timing Adjustable",
	"2.2.2":  "Pause, Stop, Hide",
	"2.3.1":  "Three Flashes or Below Threshold",
	"2.4.1":  "Bypass Blocks",
	"2.4.2":  "Page Titled",
	"2.4.3":  "Focus Order",
	"2.4.4":  "Link Purpose (In Context)",
	"2.4.5":  "Multiple Ways",
	"2.4.6":  "Headings and Labels",
	"2.4.7":  "Focus Visible",
	"2.4.10": "Section Headings",
	"2.5.1":  "Pointer Gestures",
	"2.5.2":  "Pointer Cancellation",
	"2.5.3":  "Label in Name",
	"2.5.4":  "Motion Actuation",
	"3.1.1":  "Language of Page",
	"3.1.2":  "Language of Parts",
	"3.2.1":  "On Focus",
	"3.2.2":  "On Input",
	"3.2.3":  "Consistent Navigation",
	"3.2.4":  "Consistent Identification",
	"3.3.1":  "Error Identification",
	"3.3.2":  "Labels or Instructions",
	"3.3.3":  "Error Suggestion",
	"3.3.4":  "Error Prevention (Legal, Financial, Data)",
	"4.1.1":  "Parsing",
	"4.1.2":  "Name, Role, Value",
	"4.1.3":  "Status Messages",
}
