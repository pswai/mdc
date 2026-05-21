---
RFC: 0002
Title: Tag syntax and parser strategy
Status: Draft
Author: Engineering Manager (Claude) on behalf of MDC
Created: 2026-05-21
Resolves: RFC-0001 Open Question 1; commits to a parser strategy
---

# Summary

Adopt **HTML comments with structured attributes** as the canonical MDC tag syntax. Write our own parser on `remark` + `unified`; do not depend on or fork `comment-md`. Reuse its **tag-shape concept** and its **`exportAiView` pattern**, not its code.

# Decisions

## 1. Tag syntax: HTML comments

```markdown
The quick brown fox jumps over the lazy dog. <!--mdc:ann id=a1f7q3 status=open-->

<!--mdc:comment ann=a1f7q3 by=human time=2026-05-21T10:00:00Z
Body text here, may include line breaks and basic markdown.
-->

<!--mdc:sug id=s1 by=ai
-old text
+new text
-->
```

One shape covers anchors, comments, and suggestions, distinguished by the `mdc:*` prefix on the first token.

## 2. Parser: own implementation on `remark` + `unified`

We do not depend on or fork `comment-md`. We take its tag-shape concept and its `exportAiView` pattern (strip resolved annotations before feeding to an LLM); we leave its code behind. (Evidence below.)

## 3. ID generation

6-character base32 IDs (e.g., `a1f7q3`), collision-checked at insertion against existing IDs in the file. Resolves RFC-0001 Open Question 2.

## 4. Attribute escape

HTML comment bodies do not support standard quoting. Our convention:

- `key=value` for word-safe values (no spaces, no `>` adjacent to `--`)
- `key="value with spaces"` for quoted values
- `-->` is the **single forbidden sequence** inside any attribute value or comment body
- Multi-line bodies (for comments and suggestions) are delimited by the line break after the opening attributes and the closing `-->`

Parser property tests must cover values with newlines, quotes, `>`, the `--` sequence, and nested HTML comments (illegal — must error loudly).

# Evidence

## Why HTML comments (Option A)

| Renderer                        | Behavior                                                                                          | Status                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `glow` 2.x                      | All `mdc:*` tags hidden; no whitespace artifacts                                                  | ✅ **Confirmed locally:** `glow -s notty fixtures/syntax-test/all-syntaxes.md` shows only body text                   |
| Goldmark default (`glow` → glamour) | "By default, goldmark does not render raw HTML" — comments dropped                                | ✅ Confirmed via goldmark README                                                                                      |
| GitHub web (GFM)                | GFM §4.6 strips HTML comments; sanitizer drops them                                               | ⏳ Spec-confirmed; **gist/PR verification still required** (auto-mode denied my gist creation — user action needed)   |
| Obsidian Reading View           | Native is `%% %%`; HTML comments widely reported hidden                                           | ⏳ **Not confirmed.** Subagent could not reach Obsidian docs (404s on the comments help page). User action needed.    |

## Why not custom XML-like tags (Option B)

Confirmed via the same local `glow` run:

- Empty-content anchors like `<annotation id="a1"></annotation>` are invisible (tag stripped, no content)
- `<comment>...</comment>` exposes its **inner content as rendered markdown text**. From the fixture: `Is "lazy" the right word here?` and the AI's reply rendered as visible body paragraphs

That fails the requirement for thread bodies: comment text would leak into every rendered view as ambient document content. Disqualifying for our format, even though `comment-md` chose this shape.

## Why not Obsidian `%% %%` (Option C)

`%%` and wrapped content rendered **literally** in glow — confirmed locally. Obsidian-only syntax breaks portability and violates Commitment 1 (the file must read cleanly everywhere).

## Why write our own parser (not depend on `comment-md`)

Verified at `comment-md` repo state `b1ee36a` (research subagent, cited):

- Parser is regex over raw source (`core/src/parser.ts:18-22`), not a remark/unified AST. Breaks on nested tags, `>` in attributes, anything not anticipated by the regex.
- `serialize()` self-admits in a code comment that it **appends annotations rather than restoring positions** (`parser.ts:261-262`). Disqualifies for our v0 DoD round-trip requirement.
- The one "roundtrip" test asserts id/status survive a re-parse, not byte equality (`__tests__/serializer.test.ts:83-110`).
- No frontmatter tests. npm packages frozen at `0.1.1` (2026-03-04). 4 stars. Dormant on code ~2 months.
- Two parsers (regex core + regex remark plugin) with duplicated logic and no shared core.

Forking inherits the regex foundation we'd throw away. Writing on `remark` + `unified` (already committed in RFC-0001) is the path. **Steal the tag-shape idea and the `exportAiView` pattern; leave the code.**

# Verification status

| Item                                                | Status                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Glow / goldmark hides Option A                      | ✅ Confirmed locally                                                                                               |
| Glow leaks Option B body content                    | ✅ Confirmed locally — disqualifies B for threads                                                                  |
| Glow renders Option C literally                     | ✅ Confirmed locally — disqualifies C                                                                              |
| GitHub web hides Option A                           | ⏳ Spec-confirmed; gist verification blocked by auto-mode classifier — **user action requested**                   |
| Obsidian Reading View hides Option A                | ⏳ Reasoned likely; subagent could not confirm — **user action requested**                                         |
| Attribute escape policy holds under round-trip stress | ⏳ Will be covered by parser property tests in Phase 1                                                            |

The fixture `fixtures/syntax-test/all-syntaxes.md` is the test artifact. Two cheap things close the remaining cells: drop the file into an Obsidian vault and a GitHub gist, eyeball the rendered output. If either leaks, this RFC must be revised before acceptance.

# Risks

1. **Obsidian may differ from goldmark.** Obsidian is a likely primary surface. Mitigation: verify before Phase 1; if A leaks there, revisit (e.g., fenced `mdc-comment` code blocks for thread bodies while keeping HTML comments for anchors).
2. **Attribute escape edge cases.** Must be covered by parser property tests, not assumed.
3. **`exportAiView` is not free.** Stripping resolved annotations safely without disturbing surrounding text needs the parser to understand annotation extent — but that's the same machinery as suggestion accept/reject, so not a separate effort.

# Definition of done

This RFC moves to `Accepted` when:

- [ ] User confirms Obsidian Reading View hides Option A on `fixtures/syntax-test/all-syntaxes.md`
- [ ] User (or a follow-up verification step) confirms GitHub web hides Option A in a real PR or gist context
- [ ] If either fails, this RFC is updated with the failure mode and a revised recommendation before acceptance

# References

- Research: [`docs/research/0001-format-and-parser.md`](../research/0001-format-and-parser.md)
- Fixture: [`fixtures/syntax-test/all-syntaxes.md`](../../fixtures/syntax-test/all-syntaxes.md)
- RFC-0001: [`./0001-v0-scope-and-format.md`](./0001-v0-scope-and-format.md)
- `comment-md`: https://github.com/huyansheng3/markdown-comment
- Goldmark: https://github.com/yuin/goldmark
- GFM spec §4.6: https://github.github.com/gfm/
