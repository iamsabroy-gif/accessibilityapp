# Feedback on `suggestion_iteration1.md`

**To:** Loco
**From:** review pass on `implementation_iteration1.md` Task 5.1 / `suggestion_iteration1.md`
**Re:** the "12 vs 20" `NotAutomatable` count discrepancy in `internal/models/sc_registry.go`

---

## 1. What you got right

Before getting into the one thing that needs fixing, credit where it's due:

- **Tasks 1, 2, 3, 4, 6, and 7** in `suggestion_iteration1.md` were all validated correctly — no changes needed on any of them. Good, careful work.
- **§4's suggestion** — have the dev agent compute the live test count via `grep -c '^=== RUN'` instead of hardcoding a test count of 19/20 — is genuinely good practice. Hardcoded counts rot the moment someone adds or removes a test; deriving it live from the test run output is the right call. **Keep this recommendation as-is.**

Only Task 5.1's count is in dispute. Everything else in your pass stands.

## 2. The grep discrepancy, walked through

Your command, reproduced exactly:

```
grep -c 'NotAutomatable: true' internal/models/sc_registry.go
```

Result: **12**

Whitespace-flexible version of the same query:

```
grep -oE 'NotAutomatable:[[:space:]]*true' internal/models/sc_registry.go | wc -l
```

Result: **20**

That 8-line gap is the whole discrepancy. Here's the full annotated dump of every `NotAutomatable:` line in the file, with the 8 that your fixed-single-space pattern silently skipped marked:

```
49:  NotAutomatable: true,
55:  NotAutomatable: true,
62:  NotAutomatable:        true,      ← extra padding, single-space grep misses this
123: NotAutomatable:        true,      ← extra padding
147: NotAutomatable: true,
208: NotAutomatable:        true,      ← extra padding
214: NotAutomatable: true,
220: NotAutomatable: true,
226: NotAutomatable: true,
268: NotAutomatable: true,
302: NotAutomatable:        true,      ← extra padding
317: NotAutomatable: true,
349: NotAutomatable: true,
355: NotAutomatable: true,
361: NotAutomatable: true,
385: NotAutomatable:        true,      ← extra padding
391: NotAutomatable: true,
415: NotAutomatable:        true,      ← extra padding
461: NotAutomatable:        true,      ← extra padding
468: NotAutomatable:        true,      ← extra padding
```

**Root cause:** `gofmt` aligns struct-literal field values in columns. When a struct literal also contains a longer field name in the same block — e.g. `ManualTestingRequired:` or `EN301549Clause:` — gofmt pads the shorter `NotAutomatable:` key with extra spaces so all the values line up vertically. Your grep pattern `'NotAutomatable: true'` is a fixed single-space match, so every line where gofmt inserted that extra padding was invisible to it. This is a **false negative in the grep pattern**, not a real discrepancy in the registry contents.

## 3. Bottom line on the count

**`implementation_iteration1.md` Task 5.1's original figure of 20 is CONFIRMED CORRECT and must NOT be changed.**

The 20 SCIDs found at (or immediately near) all 20 matches line up exactly with the original breakdown — 15 previously-unmapped A/AA SCs + 2 WCAG-2.2-only-incomplete SCs (3.2.6, 3.3.7) + 3 real-rule SCs (1.2.3, 2.2.1, 2.4.5):

```
1.2.3, 1.2.4, 1.2.5, 1.4.2, 1.4.5, 2.1.4, 2.2.1, 2.2.2, 2.3.1, 2.4.5,
2.5.2, 2.5.4, 3.2.2, 3.2.3, 3.2.4, 3.2.6, 3.3.3, 3.3.4, 3.3.7, 4.1.3
```

Your "12" claim is wrong, and the assertion in `suggestion_iteration1.md` that "20" is "both arithmetically and factually wrong" is itself the incorrect statement. If the recommended edit to change Task 5.1's figure from 20 to 12 has already been applied anywhere, please revert it — the dev agent should proceed with the original wording as-is.

## 4. You noticed the right symptom — just drew the wrong conclusion

This is worth calling out explicitly, because it reflects well on your process even though the final answer was off: in §3, second bullet, of your own doc, you wrote:

> "The other 6 (1.2.5, 1.4.2, 2.1.4, 2.5.2, 3.3.3, 4.1.3) were confirmed `NotAutomatable: true` in an earlier per-SC source read — yet they do not appear in the grep. This discrepancy means either (a) the earlier per-SC reads hit stale buffer state, or (b) the registry was since edited."

That's exactly the symptom of the bug — you had independent confirmation that contradicted your grep output, and you flagged the contradiction instead of ignoring it. That instinct was right. Where it went sideways was the next step: you looked for an explanation in the *data* (stale reads, registry edits) rather than interrogating the *tool* that produced the conflicting number. When a fast, mechanical check (grep) disagrees with a slower, more careful check (per-SC source reads), the fast mechanical one is usually the one to distrust first, especially on gofmt-formatted source where column alignment is a known hazard. Noticing the contradiction was the right instinct; the miss was not turning that suspicion on the grep pattern itself before concluding the registry had drifted.

## 5. General methodology guidance for future passes

A few reusable takeaways for verification work on this repo (and any gofmt-formatted Go codebase):

- **Prefer whitespace-flexible patterns over fixed-width string matches** when grepping struct-literal `key: value` pairs — use `[[:space:]]+` (POSIX grep) or `\s+` (PCRE/ripgrep) instead of a literal single space. `gofmt`'s column-alignment rewriting is a known, recurring source of exactly this class of false negative, and it will keep resurfacing anytime a struct literal mixes short and long field names (`NotAutomatable` next to `ManualTestingRequired` or `EN301549Clause` is precisely that case).
- **Better still, don't line-match formatted source at all for structural questions.** Parse per-entry: read each SC's struct block and check the boolean field value directly, rather than grepping for a specific textual rendering of it.
- **Best of all, use AST-based tooling** for anything that depends on Go struct semantics — `go vet`, or a small throwaway Go program using `go/parser`/`go/ast` to walk the composite literals and count `NotAutomatable: true` fields structurally. That approach is immune to formatting changes entirely and would have caught this on the first pass.

Nice catch on Tasks 1–4/6/7 and the §4 test-count fix — just tighten up the grep methodology for structural/boolean-field counts going forward and this class of false positive won't recur.
