package main

import (
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/webaccessibility/server/internal/visits"
)

func main() {
	filePath := flag.String("file", "data/visits.jsonl", "Path to visits.jsonl file")
	monthFilter := flag.String("month", "", "Optional month filter in YYYY-MM format (e.g. 2026-10)")
	format := flag.String("format", "table", "Output format: table, csv, or json")
	flag.Parse()

	// Fallback to env var if default was not modified and env var exists
	if *filePath == "data/visits.jsonl" && os.Getenv("VISIT_STORE_PATH") != "" {
		*filePath = os.Getenv("VISIT_STORE_PATH")
	}

	records, err := visits.ReadFile(*filePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading %s: %v\n", *filePath, err)
		os.Exit(1)
	}

	if len(records) == 0 {
		fmt.Fprintf(os.Stderr, "No visit records found in %s\n", *filePath)
		return
	}

	summaries := visits.AggregateByMonth(records)
	if len(summaries) == 0 {
		fmt.Fprintf(os.Stderr, "No valid visit records to aggregate in %s\n", *filePath)
		return
	}

	// Filter months if requested
	var months []string
	if *monthFilter != "" {
		if _, ok := summaries[*monthFilter]; !ok {
			fmt.Fprintf(os.Stderr, "No visit records found for month %s\n", *monthFilter)
			return
		}
		months = []string{*monthFilter}
	} else {
		for m := range summaries {
			months = append(months, m)
		}
		sort.Strings(months)
	}

	switch strings.ToLower(*format) {
	case "csv":
		printCSV(summaries, months)
	case "json":
		printJSON(summaries, months)
	default:
		printTable(summaries, months)
	}
}

func printTable(summaries map[string]*visits.MonthlySummary, months []string) {
	for _, m := range months {
		s := summaries[m]
		fmt.Println("================================================================================")
		fmt.Printf(" AccessScan Return-Visit Frequency Report — %s\n", m)
		fmt.Println("================================================================================")
		fmt.Printf(" Total Registered Users Seen:  %d\n", s.TotalUsers)
		fmt.Printf(" Returning Users (≥2 days):    %d (%.1f%% of active users)\n", s.ReturnUsers, s.ReturnUserPct)
		fmt.Printf(" Frequent Users (≥5 days):     %d\n", s.FrequentUsers)
		fmt.Printf(" Total Active Days:            %d\n", s.TotalVisitDays)
		fmt.Printf(" Total Visit Pings:            %d\n", s.TotalVisits)
		fmt.Println("--------------------------------------------------------------------------------")
		fmt.Printf(" %-40s %-10s %-12s %-12s\n", "User Email", "Month", "Active Days", "Total Pings")
		fmt.Println("--------------------------------------------------------------------------------")
		for _, u := range s.Users {
			fmt.Printf(" %-40s %-10s %-12d %-12d\n", truncate(u.Email, 39), u.Month, u.VisitDays, u.TotalVisits)
		}
		fmt.Println()
	}
}

func printCSV(summaries map[string]*visits.MonthlySummary, months []string) {
	writer := csv.NewWriter(os.Stdout)
	defer writer.Flush()

	_ = writer.Write([]string{"email", "month", "visit_days", "total_visits"})
	for _, m := range months {
		s := summaries[m]
		for _, u := range s.Users {
			_ = writer.Write([]string{
				u.Email,
				u.Month,
				strconv.Itoa(u.VisitDays),
				strconv.Itoa(u.TotalVisits),
			})
		}
	}
}

func printJSON(summaries map[string]*visits.MonthlySummary, months []string) {
	var list []*visits.MonthlySummary
	for _, m := range months {
		list = append(list, summaries[m])
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(list)
}

func truncate(s string, max int) string {
	if len(s) > max {
		return s[:max-3] + "..."
	}
	return s
}
