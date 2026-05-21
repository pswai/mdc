# Research 0001 — Format and Parser

Date: 2026-05-21. "Confirmed" = read in repo at `b1ee36a`; otherwise source cited.

## Question 1: comment-md viability — **Write our own; steal the format, skip the package.**

**Evidence**
- License MIT. Both npm packages (`comment-md-core`, `comment-md-remark-plugin`) frozen at `0.1.1`, published 2026-03-04. Confirmed via `package.json` + registry JSON.
- 4 stars. Last commit `b1ee36a` (2026-03-21, docs only). Last code change `8f5de4a` (VSCode extension). Confirmed via `git log`.
- **Parser is regex over raw source**, not remark/unified AST (`core/src/parser.ts:18-22`). Builds `cleanMarkdown` by string-slicing; breaks on nested tags, `>` in attributes, or any markdown the regex didn't anticipate.
- **Round-trip is not actually tested.** The one "roundtrip" test (`__tests__/serializer.test.ts:83-110`) only asserts id/status survive a re-parse, not byte-equality. `serialize()` carries a self-admission: *"In a full implementation, we would need to track where to insert each annotation back… For now, we append them."* (`parser.ts:261-262`). Disqualifying for our v0 DoD.
- **No frontmatter test** in `__tests__/`. Remark plugin has one nested-list and one code-block-in-annotation test (`plugin.test.ts:215-237`); core has neither. Frontmatter handling lives only in the VSCode UI layer.
- Two parsers, not one: core (regex) and remark-plugin (separate regex attaching `data-annotation-*` hProperties to mdast). Logic duplicated, no shared core.

**Risks**
- Depend → parser unfit for our DoD; single maintainer; dormant on code.
- Fork → still inherits regex design; we'd rewrite anyway.
- Write our own on `remark` + `unified` (proposal §6 already commits to this). Reuse comment-md's **tag shape** and **`exportAiView` idea**, not its code.

## Question 2: Tag syntax — **Provisional: HTML comments (Option A). Hands-on verify before locking.**

**Option A — `<!--mdc:ann id=a1-->`**
- GitHub web: hidden. GFM rule 2 + GitHub sanitizer drop comments (GFM spec §4.6). Spec-confirmed, not eyeball-confirmed.
- Obsidian Reading View: likely hidden — Obsidian's native form is `%% %%`, HTML comments widely reported hidden. Every official help URL I tried returned 404. **Not confirmed.**
- glow → glamour → goldmark. Goldmark README: *"By default, goldmark does not render raw HTML…"* (github.com/yuin/goldmark). Glamour uses the default. **High confidence hidden, not end-to-end confirmed.**

**Option B — `<annotation id="a1">…</annotation>`**
- GitHub: unknown tag stripped by sanitizer; **inner content renders as normal markdown**. Invisible scaffolding, exposed body — fine for visible threads, wrong for anchors.
- Obsidian: same expected behavior. Needs hands-on.
- glow/goldmark default: stripped (tag and likely content too).

**Option C — also considered**
- Obsidian-native `%%mdc:ann%%`: invisible in Obsidian, **literal text everywhere else**. Reject.
- Fenced ` ```mdc-ann ` blocks: visible noise in every renderer. Reject for anchors; could work for thread bodies if A's multiline form turns brittle.

**Recommendation:** A for anchors. B as fallback only if A leaks in Obsidian. Optional fenced block for long thread bodies.

**Hands-on still required (before Phase 1)**
1. Obsidian Reading View, A and B fixtures — confirm invisibility, no whitespace artifacts.
2. glow terminal — confirm no bleed.
3. GitHub gist/PR — confirm spec matches reality.
4. Stress `<!--mdc:ann attr="contains > char"-->` — escape policy.
