package report

import (
	"bytes"
	"fmt"
	"html/template"
	"strings"
	"time"

	"github.com/webaccessibility/server/internal/models"
)

const impactColor = `
  critical:#fc5c65
  serious:#fc8181
  moderate:#f6e05e
  minor:#68d391
`

var impactColors = map[string]string{
	"critical": "#fc5c65",
	"serious":  "#fc8181",
	"moderate": "#f6e05e",
	"minor":    "#68d391",
}

var impactBg = map[string]string{
	"critical": "#3b1218",
	"serious":  "#3b1818",
	"moderate": "#3b3210",
	"minor":    "#0f3b1f",
}

const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Accessibility Report – {{.URL}}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; }

  /* ── Header ── */
  .header { background: linear-gradient(135deg, #1a1f2e 0%, #0f1117 100%); border-bottom: 1px solid #2d3748; padding: 2rem; }
  .header h1 { font-size: 1.75rem; font-weight: 700; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: .25rem; }
  .header .url { font-size: .85rem; color: #718096; word-break: break-all; }
  .header .meta { font-size: .8rem; color: #4a5568; margin-top: .5rem; }

  /* ── Score cards ── */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; padding: 1.5rem 2rem; }
  .card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 12px; padding: 1.25rem; text-align: center; }
  .card .value { font-size: 2rem; font-weight: 700; line-height: 1; }
  .card .label { font-size: .75rem; color: #718096; margin-top: .35rem; text-transform: uppercase; letter-spacing: .05em; }
  .score-A { color: #48bb78; } .score-B { color: #68d391; }
  .score-C { color: #f6e05e; } .score-D { color: #fc8181; } .score-F { color: #fc5c65; }

  /* ── Section ── */
  .section { padding: 0 2rem 2rem; }
  .section h2 { font-size: 1.1rem; font-weight: 600; color: #a0aec0; border-bottom: 1px solid #2d3748; padding-bottom: .5rem; margin-bottom: 1rem; }

  /* ── Compliance bar ── */
  .bar-wrap { background: #2d3748; border-radius: 99px; height: 8px; overflow: hidden; margin: .5rem 0 1.5rem; }
  .bar-fill { height: 100%; border-radius: 99px; background: linear-gradient(90deg, #6366f1, #8b5cf6); }

  /* ── Screenshot overlay panel ── */
  .screenshot-panel { position: relative; display: inline-block; max-width: 100%; border-radius: 8px; overflow: visible; }
  .screenshot-panel img { display: block; max-width: 100%; border-radius: 8px; border: 1px solid #2d3748; }
  /* Violation overlay box */
  .vbox {
    position: absolute;
    border: 2px solid var(--c);
    border-radius: 3px;
    cursor: pointer;
    transition: box-shadow .2s;
    pointer-events: auto;
  }
  .vbox:hover { box-shadow: 0 0 0 3px var(--c); z-index: 10; }
  .vbox:hover .vtip { display: block; }
  /* Numbered badge */
  .vbadge {
    position: absolute;
    top: -12px; left: -12px;
    width: 22px; height: 22px;
    border-radius: 50%;
    background: var(--c);
    color: #0f1117;
    font-size: .65rem;
    font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 1px 4px rgba(0,0,0,.5);
    z-index: 5;
  }
  /* Tooltip */
  .vtip {
    display: none;
    position: absolute;
    top: calc(100% + 6px); left: 0;
    background: #1a1f2e;
    border: 1px solid #2d3748;
    border-radius: 6px;
    padding: .6rem .85rem;
    min-width: 220px;
    max-width: 320px;
    z-index: 20;
    box-shadow: 0 4px 16px rgba(0,0,0,.5);
  }
  .vtip .vt-id { font-size: .8rem; font-weight: 600; color: var(--c); margin-bottom: .2rem; }
  .vtip .vt-desc { font-size: .75rem; color: #a0aec0; }

  /* ── Violation list ── */
  .violation { background: #1a1f2e; border: 1px solid #2d3748; border-left: 4px solid var(--c); border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: .75rem; }
  .v-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: .5rem; }
  .v-num { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: var(--c); color: #0f1117; font-size: .65rem; font-weight: 700; flex-shrink: 0; }
  .v-id { font-size: .85rem; font-weight: 600; color: #e2e8f0; }
  .badge { font-size: .7rem; font-weight: 600; padding: .15rem .6rem; border-radius: 99px; text-transform: uppercase; background: var(--bg); color: var(--c); }
  .v-desc { font-size: .82rem; color: #a0aec0; margin-bottom: .4rem; }
  .v-help a { font-size: .8rem; color: #6366f1; text-decoration: none; }
  .v-help a:hover { text-decoration: underline; }
  .nodes { margin-top: .75rem; }
  .node { background: #0f1117; border-radius: 6px; padding: .6rem .8rem; margin-bottom: .4rem; font-family: monospace; font-size: .75rem; color: #9ca3af; white-space: pre-wrap; word-break: break-all; border: 1px solid #2d3748; }

  /* ── Passes ── */
  .passes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: .5rem; }
  .pass-item { background: #0f2318; border: 1px solid #1a4731; color: #48bb78; border-radius: 6px; padding: .4rem .75rem; font-size: .78rem; font-family: monospace; }

  /* ── Dev Suggestion panel ── */
  .suggestion {
    margin-top: .9rem;
    border: 1px solid #2d3748;
    border-radius: 8px;
    background: #0d111c;
    overflow: hidden;
  }
  .suggestion summary {
    padding: .55rem 1rem;
    font-size: .8rem;
    font-weight: 600;
    color: #a78bfa;
    cursor: pointer;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    gap: .4rem;
  }
  .suggestion summary::-webkit-details-marker { display: none; }
  .suggestion summary::before { content: '▶'; font-size: .6rem; transition: transform .2s; }
  .suggestion[open] summary::before { transform: rotate(90deg); }
  .suggestion summary:hover { background: #151c2e; }
  .fix-steps {
    margin: 0 1rem .75rem 2rem;
    padding: 0;
    font-size: .78rem;
    color: #cbd5e0;
    line-height: 1.6;
  }
  .fix-steps li { margin-bottom: .25rem; }
  .code-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: .5rem;
    padding: 0 1rem .75rem;
  }
  @media (max-width: 680px) { .code-pair { grid-template-columns: 1fr; } }
  .code-block {
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #2d3748;
  }
  .code-label {
    font-size: .7rem;
    font-weight: 700;
    padding: .25rem .6rem;
    letter-spacing: .04em;
  }
  .code-block.bad  .code-label { background: #3b1212; color: #fc8181; }
  .code-block.good .code-label { background: #0e3320; color: #6ee7b7; }
  .code-block pre {
    margin: 0;
    padding: .6rem .8rem;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: .72rem;
    line-height: 1.55;
    color: #9ca3af;
    white-space: pre-wrap;
    word-break: break-all;
    background: #0f1117;
  }

  /* ── Footer ── */
  .footer { text-align: center; padding: 2rem; font-size: .75rem; color: #4a5568; border-top: 1px solid #1a1f2e; }

  /* scale note */
  .scale-note { font-size: .72rem; color: #4a5568; margin-bottom: .5rem; }
</style>
</head>
<body>

<div class="header">
  <h1>♿ Accessibility Report</h1>
  <div class="url">{{.URL}}</div>
  <div class="meta">Scanned {{.ScannedAt}} · Level {{.Summary.Level}} · Duration {{.DurationMs}}ms</div>
</div>

<!-- Score cards -->
<div class="cards">
  <div class="card">
    <div class="value {{scoreClass .Summary.Grade}}">{{.Summary.Score}}</div>
    <div class="label">Score (0–100)</div>
  </div>
  <div class="card">
    <div class="value {{scoreClass .Summary.Grade}}">{{.Summary.Grade}}</div>
    <div class="label">Grade</div>
  </div>
  <div class="card">
    <div class="value" style="color:#fc5c65">{{.Summary.ViolationCount}}</div>
    <div class="label">Violations</div>
  </div>
  <div class="card">
    <div class="value" style="color:#48bb78">{{.Summary.PassCount}}</div>
    <div class="label">Passes</div>
  </div>
  <div class="card">
    <div class="value" style="color:#f6e05e">{{.Summary.IncompleteCount}}</div>
    <div class="label">Incomplete</div>
  </div>
  <div class="card">
    <div class="value" style="color:#6366f1">{{printf "%.1f" .Summary.CompliancePct}}%</div>
    <div class="label">Compliance</div>
  </div>
</div>

<div class="section">
  <div class="bar-wrap"><div class="bar-fill" style="width:{{printf "%.1f" .Summary.CompliancePct}}%"></div></div>
</div>

{{if .Screenshot}}
<!-- ── Annotated page screenshot ── -->
<div class="section">
  <h2>🖼 Annotated Page Screenshot</h2>
  <p class="scale-note">Hover over a numbered badge to see the violation. The image is scaled to fit — overlays are repositioned proportionally via JavaScript.</p>
  <div class="screenshot-panel" id="ssPanel">
    <img id="ssImg" src="data:image/png;base64,{{.Screenshot}}" alt="Full-page screenshot of {{.URL}}" />
    {{range .Violations}}{{range .Nodes}}{{if .BBox}}
    <div class="vbox"
         data-x="{{.BBox.X}}" data-y="{{.BBox.Y}}"
         data-w="{{.BBox.Width}}" data-h="{{.BBox.Height}}"
         data-vidx="{{violIdx $.Violations .}}"
         style="--c:{{violColor $.Violations .}}; display:none;">
      <div class="vbadge">{{violIdx $.Violations .}}</div>
      <div class="vtip">
        <div class="vt-id">{{violID $.Violations .}}</div>
        <div class="vt-desc">{{violDesc $.Violations .}}</div>
      </div>
    </div>
    {{end}}{{end}}{{end}}
  </div>
</div>
{{end}}

{{if .Violations}}
<!-- ── Violations list ── -->
<div class="section">
  <h2>⚠ Violations ({{len .Violations}})</h2>
  {{range .Violations}}
  <div class="violation" style="--c:{{impactColor .Impact}}; --bg:{{impactBg .Impact}}">
    <div class="v-header">
      <span style="display:flex;align-items:center;gap:.5rem;">
        <span class="v-num" style="--c:{{impactColor .Impact}}">{{.ViolationIndex}}</span>
        <span class="v-id">{{.ID}}</span>
      </span>
      <span class="badge">{{.Impact}}</span>
    </div>
    <div class="v-desc">{{.Description}}</div>
    <div class="v-help"><a href="{{.HelpURL}}" target="_blank" rel="noopener">{{.Help}} ↗</a></div>
    {{if .Nodes}}
    <div class="nodes">{{range .Nodes}}<div class="node">{{.HTML}}</div>{{end}}</div>
    {{end}}
    {{if .DevSuggestion}}
    <details class="suggestion">
      <summary>🛠 Dev Fix: {{.DevSuggestion.Title}}</summary>
      <ol class="fix-steps">
        {{range .DevSuggestion.FixSteps}}<li>{{.}}</li>{{end}}
      </ol>
      {{if .DevSuggestion.CodeBefore}}
      <div class="code-pair">
        <div class="code-block bad">
          <div class="code-label">❌ Before (broken)</div>
          <pre><code>{{.DevSuggestion.CodeBefore}}</code></pre>
        </div>
        <div class="code-block good">
          <div class="code-label">✅ After (fixed)</div>
          <pre><code>{{.DevSuggestion.CodeAfter}}</code></pre>
        </div>
      </div>
      {{end}}
    </details>
    {{end}}
  </div>
  {{end}}
</div>
{{end}}

{{if .Passes}}
<!-- ── Passes ── -->
<div class="section">
  <h2>✓ Passing Rules ({{len .Passes}})</h2>
  <div class="passes-grid">{{range .Passes}}<div class="pass-item">{{.}}</div>{{end}}</div>
</div>
{{end}}

<div class="footer">Generated by Web Accessibility API · {{.ScannedAt}}</div>

{{if .Screenshot}}
<script>
// Reposition overlay boxes proportionally to the rendered image size
(function () {
  const img = document.getElementById('ssImg');
  const panel = document.getElementById('ssPanel');
  function positionBoxes() {
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    const renderedW = img.offsetWidth;
    const renderedH = img.offsetHeight;
    if (!naturalW || !renderedW) return;
    const scaleX = renderedW / naturalW;
    const scaleY = renderedH / naturalH;
    panel.style.height = renderedH + 'px';
    document.querySelectorAll('.vbox').forEach(function(box) {
      const x = parseInt(box.dataset.x, 10);
      const y = parseInt(box.dataset.y, 10);
      const w = parseInt(box.dataset.w, 10);
      const h = parseInt(box.dataset.h, 10);
      box.style.left   = Math.round(x * scaleX) + 'px';
      box.style.top    = Math.round(y * scaleY) + 'px';
      box.style.width  = Math.max(Math.round(w * scaleX), 14) + 'px';
      box.style.height = Math.max(Math.round(h * scaleY), 14) + 'px';
      box.style.display = 'block';
    });
  }
  if (img.complete) { positionBoxes(); }
  img.addEventListener('load', positionBoxes);
  window.addEventListener('resize', positionBoxes);
})();
</script>
{{end}}
</body>
</html>`

// templateData wraps ScanResult with a pre-formatted timestamp.
type templateData struct {
	*models.ScanResult
	ScannedAt string
}

// violationByNode is a helper to look up the violation a given node belongs to.
type nodeViolPair struct {
	v *models.Violation
	n *models.Node
}

func buildNodeMap(violations []models.Violation) map[*models.Node]*models.Violation {
	m := make(map[*models.Node]*models.Violation)
	for i := range violations {
		v := &violations[i]
		for j := range v.Nodes {
			m[&v.Nodes[j]] = v
		}
	}
	return m
}

// Generate builds a self-contained HTML accessibility report from a ScanResult.
func Generate(result *models.ScanResult) (string, error) {
	funcMap := template.FuncMap{
		"scoreClass": func(grade string) string {
			switch strings.ToUpper(grade) {
			case "A":
				return "score-A"
			case "B":
				return "score-B"
			case "C":
				return "score-C"
			case "D":
				return "score-D"
			default:
				return "score-F"
			}
		},
		"printf": fmt.Sprintf,
		"impactColor": func(impact string) string {
			if c, ok := impactColors[impact]; ok {
				return c
			}
			return "#718096"
		},
		"impactBg": func(impact string) string {
			if bg, ok := impactBg[impact]; ok {
				return bg
			}
			return "#1a1f2e"
		},
		// For the screenshot overlay we need to look up parent violation from a node.
		// We pass the full violations slice and the node to find which violation it belongs to.
		"violIdx": func(violations []models.Violation, node models.Node) int {
			for i := range violations {
				for _, n := range violations[i].Nodes {
					if n.HTML == node.HTML && len(n.Target) > 0 && len(node.Target) > 0 && n.Target[0] == node.Target[0] {
						return violations[i].ViolationIndex
					}
				}
			}
			return 0
		},
		"violColor": func(violations []models.Violation, node models.Node) string {
			for i := range violations {
				for _, n := range violations[i].Nodes {
					if n.HTML == node.HTML {
						if c, ok := impactColors[violations[i].Impact]; ok {
							return c
						}
					}
				}
			}
			return "#718096"
		},
		"violID": func(violations []models.Violation, node models.Node) string {
			for i := range violations {
				for _, n := range violations[i].Nodes {
					if n.HTML == node.HTML {
						return violations[i].ID
					}
				}
			}
			return ""
		},
		"violDesc": func(violations []models.Violation, node models.Node) string {
			for i := range violations {
				for _, n := range violations[i].Nodes {
					if n.HTML == node.HTML {
						return violations[i].Description
					}
				}
			}
			return ""
		},
	}

	tmpl, err := template.New("report").Funcs(funcMap).Parse(htmlTemplate)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	data := templateData{
		ScanResult: result,
		ScannedAt:  result.ScannedAt.In(time.UTC).Format("2006-01-02 15:04:05 UTC"),
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}
	return buf.String(), nil
}
