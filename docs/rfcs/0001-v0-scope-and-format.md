---
RFC: 0001
Title: MDC v0 — Format, CLI, and Preview
Status: Accepted
Author: Engineering Manager (Claude) on behalf of MDC
Created: 2026-05-21
Accepted: 2026-05-21
Supersedes: —
---

# Summary

Define v0 of MDC: an in-file annotation format for markdown, a CLI to manipulate it, and a minimal browser preview. Just enough to dogfood the human-AI loop end to end for two weeks. Nothing more.

This RFC distills the seed proposal at [`docs/proposals/0001-vision-and-landscape.md`](../proposals/0001-vision-and-landscape.md). The landscape analysis there is the justification for this scope; this RFC is the contract.

# Goals

1. A markdown extension that carries **comments**, **suggestions**, and **threaded replies** inline, in still-valid markdown.
2. A CLI that adds, lists, accepts, rejects, and resolves these annotations — usable by humans and any agent harness without coupling to a specific one.
3. A minimal browser preview that renders annotations with inline highlights, lets a human accept/reject suggestions, and hot-reloads on file change.
4. Round-trip fidelity: `serialize(parse(x)) === x` for fixtures covering frontmatter, nested lists, code blocks, tables.

# Non-goals (explicit)

The following are out of scope for v0. Each requires a separate accepted RFC to enter scope:

- GUI editor (use any existing markdown editor — VSCode, Obsidian, vim)
- LLM integration (harnesses drive the CLI; the CLI calls no model)
- Real-time multi-user collaboration; CRDT; Automerge; Yjs
- MCP server (CLI first; an MCP wrapper can come later if useful)
- Replacing Cursor / Obsidian / Claude Code
- Provenance tracking on the document body (comments and suggestions carry `by=ai|human`; body spans do not). [See Open Question 5.]

# Format

In-file annotations expressed in syntax that survives common markdown renderers (GitHub, Obsidian, terminal renderers) without visible noise. Three primitive tag families:

- `mdc:ann` — an anchor on a span, with a stable short ID, and zero or more comments threaded against it
- `mdc:comment` — a single comment, attached to an `ann`, with `by={human|ai}` and `time`
- `mdc:sug` — a proposed edit (old → new) with a stable ID, accepted or rejected as a unit

**Starting position** (pending RFC-0002 once tag-syntax research lands): HTML comments with structured attributes, e.g.:

```markdown
The quick brown fox jumps over the lazy dog. <!--mdc:ann id=a1f7q3 status=open-->

<!--mdc:comment ann=a1f7q3 by=human time=2026-05-21T10:00:00Z
Is "lazy" the right word here?
-->
```

The exact syntax is the single most consequential decision we have not yet locked. See Open Question 1.

# CLI surface

```
mdc read <file>             # full doc with all tags
mdc read <file> --clean     # markdown only, all mdc:* tags stripped (feed this to an LLM)
mdc list <file>             # open annotations + suggestions with IDs, one per line
mdc comment <file> "quoted text" "body" [--reply-to=<id>] [--by=human|ai]
mdc suggest <file> "old text" "new text" [--by=human|ai]
mdc accept <file> <id>      # apply suggestion's diff, remove tag
mdc reject <file> <id>      # remove tag, keep original
mdc resolve <file> <id>     # mark annotation resolved (kept in file by default)
mdc compact <file>          # strip resolved annotations
mdc serve <file>            # local preview server
```

Plain stdout, machine-readable exit codes, `--json` flag where applicable. This is the entire agent surface. If an action cannot be expressed here, it does not exist in v0.

# Preview server

`mdc serve <file>` boots a local HTTP server that:

- Renders the markdown with annotations as inline highlights + side panel
- Watches the file and pushes updates over SSE on change
- Lets the human add a comment / suggestion via the UI (writes back to the `.md`)
- Lets the human accept/reject suggestions with one click

This is `claude-review`'s shape minus the database and minus the Claude-Code-specific coupling.

# Stack

- TypeScript + Node 20+
- Parser: `remark` + `unified` (pending RFC-0002: whether we depend on `comment-md`, fork it, or write our own plugin)
- Preview: small Hono server + native file watcher + SSE
- Renderer: `remark` → `rehype` → server-rendered HTML; client-side hydration only for the comment/suggest UI
- Prettier, 2 spaces
- No CRDT, no database, no auth, no server-side state beyond the running process

# Decisions

Items 1–2 are resolved by RFC-0002. Items 3–5 were EM recommendations accepted by the user on 2026-05-21.

1. **Tag syntax — HTML comments vs `<annotation>` tags.** Resolved in [RFC-0002](./0002-tag-syntax-and-parser.md): HTML comments with structured attributes, parser written on `remark` + `unified` (not `comment-md`). RFC-0002 is Draft pending user-side Obsidian and GitHub verification.
2. **ID generation.** Resolved in [RFC-0002 §3](./0002-tag-syntax-and-parser.md#3-id-generation): 6-character base32 with collision check on insertion.
3. **Suggestion conflict policy.** Decision: if `old text` no longer matches when accepted, **fail loud**, print the conflict, require manual resolution. Never auto-merge. Tradeoff: more friction for humans editing concurrently with AI suggestions; safer correctness — aligns with [Commitment 1].
4. **Resolved comment policy.** Decision: keep in file with `status=resolved` by default; `mdc compact` strips. Tradeoff: file grows; preserves history (which is the point of [Commitment 1]).
5. **Provenance on the document body.** Decision: **skip in v0.** Comments and suggestions carry `by=ai|human`; body spans do not. Tension with the manifesto vision (which calls out provenance as a gap), but adding it now bloats the format. Revisit in a future RFC.

# Definition of done

v0 ships when **all** of these hold:

- [ ] `mdc parse fixtures/sample.md` prints an AST including annotations and suggestions
- [ ] `mdc comment file.md "quoted" "body"` adds a comment; file remains valid markdown (verified by a second-party parser)
- [ ] `mdc suggest file.md "old" "new"` adds a suggestion
- [ ] `mdc accept file.md <id>` applies the suggestion, removes the tag
- [ ] `mdc read file.md --clean` returns body with all `mdc:*` tags stripped
- [ ] `mdc serve file.md` opens a browser preview with inline comments, accept/reject buttons, live reload
- [ ] Round-trip property test passes on input fixtures (frontmatter, nested lists, code blocks, tables, GFM): `serialize(parse(x)) === x`
- [ ] **CLI idempotence property test passes:** after any sequence of `mdc comment / suggest / accept / reject / resolve`, a second `parse → serialize` cycle is byte-identical to the first. This is the property that protects against the `comment-md` trap (see RFC-0002 evidence); the input-fixture round-trip alone is necessary but insufficient.
- [ ] README with a quick start
- [ ] **Two harnesses pass the same demo script.** At least two of {Claude Code, Cursor, Aider} independently complete draft → comment → address → accept/reject using only the documented v0 CLI (`mdc comment`, `mdc suggest`, `mdc accept`, `mdc read --clean`) with **no harness-specific shim or wrapper**. The demo script is identical across harnesses; a pass means each harness completes the loop in a single session without modifications to its prompt-side configuration.

Then we use it for two weeks. Then we decide what hurts.

# Risks the EM is flagging

These are noted now so we engage them rather than discover them late:

1. **comment-md viability.** Resolved in [RFC-0002](./0002-tag-syntax-and-parser.md): own parser on `remark` + `unified`; `comment-md` is neither depended on nor forked. We reuse only its tag-shape concept and its `exportAiView` pattern.
2. **HTML comments in GitHub / Obsidian.** Verification tracked in [RFC-0002 §Verification status](./0002-tag-syntax-and-parser.md#verification-status); pending hands-on confirmation on GitHub web and Obsidian Reading View before RFC-0002 moves to Accepted.
3. **Demo couples to Claude Code in the proposal.** The DoD here softens this to "at least two harnesses tested" to honor [Commitment 3].
4. **"Two weeks of dogfood, then decide" is not a metric.** Acceptable for v0, but v1 needs honest success criteria. Out of scope for this RFC.

# References

- Seed proposal: [`docs/proposals/0001-vision-and-landscape.md`](../proposals/0001-vision-and-landscape.md)
- Manifesto: [`MANIFESTO.md`](../../MANIFESTO.md)
- Pending research: `docs/research/0001-format-and-parser.md`
