# Implementation Task — Iteration 2 (Lint Fix + Doc Correction)

**Status**: Ready for implementation
**Audience**: Antigravity IDE model-based coding agent
**Reference**: [`walkthrough_iteration1.md`](./walkthrough_iteration1.md) · [`implementation_iteration1.md`](./implementation_iteration1.md)
**Scope**: One real lint violation + one fabricated verification claim + one repo-wide command
correction. All three are small and independent — no scoring/reporting logic changes.

Do not re-verify the diagnoses below; they were confirmed directly against the live repo
(`gofmt`, `go test ./...`, `git log`) immediately before this doc was written.

---

## 1. The Problem

`walkthrough_iteration1.md` (§2, "Verification Command Results") claims:

```
$ gofmt -l ./...
(Exit code: 0)
```

This is **fabricated**. `gofmt` does not understand the `./...` package-wildcard — that syntax is
a `go build` / `go test` convention only. Running the command exactly as printed produces:

```
$ gofmt -l ./...
lstat ./...: no such file or directory
```
(exit code 2, not 0)

Running gofmt correctly (`gofmt -l .`, recursive over the actual tree) surfaces a real, currently
unaddressed formatting violation:

```
$ gofmt -l .
internal/scoring/score_test.go
```

`gofmt -d internal/scoring/score_test.go` shows two issues in
`TestBuildComplianceReport_NotAutomatableWithRealRule`:
- A blank line with trailing whitespace after `result := minimalScanResult()` (~line 227).
- A stray trailing blank line at end-of-file (~line 286), i.e. no clean final newline.

This matters because `CLAUDE.md` (line 47) documents the repo's lint command as exactly
`lint=gofmt -l ./...` — the same invalid invocation. That is almost certainly the source of the
copy-paste error that produced the false "Exit code: 0" claim in the walkthrough: the command was
either never actually run, or its (error) output was misreported as a clean pass.

---

## 2. The Fix

### 2.1 Fix the real formatting violation
**File**: `internal/scoring/score_test.go`

Run `gofmt -w internal/scoring/score_test.go` to strip the trailing whitespace and normalize the
trailing newline. Do not hand-edit — let gofmt do it, then diff to confirm only whitespace changed
(no logic touched).

**Verification**: `gofmt -l .` from the repo root must print nothing.

### 2.2 Fix the repo's documented lint command
**File**: `CLAUDE.md`, line 47

Change:
```
lint=gofmt -l ./...
```
to:
```
lint=gofmt -l .
```
(Same correction applies anywhere else in the repo that copies this exact invocation — grep for
`gofmt -l ./...` across `*.md` and fix every occurrence found.)

### 2.3 Correct the fabricated claim in walkthrough_iteration1.md
**File**: `walkthrough_iteration1.md`, §2

Replace the `gofmt -l ./...` / "(Exit code: 0)" block with the actual corrected command and its
real (post-fix) clean output:
```
$ gofmt -l .
(no output — clean)
```
Do not silently rewrite history — add a one-line note above the corrected block acknowledging the
original command was invalid and its "clean" result was not actually produced by that invocation.

---

## 3. Non-Blocking: Test-Count Wording

**Files**: `walkthrough_iteration1.md`, `fsd_implementation.md` (line ~113: "All 26 new and updated
tests pass.")

The "26" figure does not match either scoped count (`go test ./internal/scoring/... ./internal/report/... -v | grep -c '^--- PASS'` → 20) or the full touched-package count (scoring + report +
scanner → 39). It appears to be a cumulative tally across the whole multi-iteration FSD effort,
not a count of what Iteration 1 itself added or changed (~5 test functions/assertions).

**Suggestion** (doc-only, not blocking): reword to something verifiable, e.g. "26 tests across the
cumulative FSD effort (scoring, report, and scanner packages) now pass; Iteration 1 itself added N
new test functions" — filling in N from an actual diff count
(`git show 2702f1a 1eab326 --stat` + reading the new `func Test` additions), not a round number.

---

## 4. Verification Command Cheat-Sheet

```bash
cd /Users/sabyasachiroy/projects/webaccessibility
gofmt -l .                                    # must print nothing
go build ./...                                # must stay clean
go test ./...                                 # must stay green
git diff --stat                               # confirm only whitespace changed in score_test.go
grep -rn 'gofmt -l \./\.\.\.' --include='*.md' .   # must return zero matches after §2.2/§2.3
```

---

## 5. Acceptance Criteria

- [ ] `gofmt -l .` prints no output.
- [ ] `internal/scoring/score_test.go`'s diff (vs. pre-fix) contains only whitespace changes —
      confirm via `git diff internal/scoring/score_test.go` showing no logic lines touched.
- [ ] `CLAUDE.md` line 47 uses `gofmt -l .`, not `gofmt -l ./...`.
- [ ] `walkthrough_iteration1.md` §2's gofmt block shows the corrected command and real output,
      with a note explaining the original was invalid.
- [ ] No other `.md` file in the repo still contains the invalid `gofmt -l ./...` invocation.
- [ ] (Non-blocking) Test-count wording in `walkthrough_iteration1.md` /
      `fsd_implementation.md` is reworded to be verifiable, or left as-is if the team accepts it
      as a known-approximate cumulative figure.
