# Project Context: Markdown-Native Human-AI Document Collaboration

## The Problem

The best medium for human-AI collaboration on text is **markdown** — the lingua franca LLMs already emit and humans can read raw. But markdown as a collaboration surface is impoverished compared to what humans built for human-human collaboration twenty years ago:

- No inline comments anchored to spans
- No suggestion mode (accept/reject proposed edits)
- No threaded discussion against a specific span
- No span-level addressing both sides can reference
- No provenance — which span came from human vs AI

Current state of practice: paste whole doc back to the LLM, quote-and-respond, or describe locations in prose. That is a regression from 2006 Google Docs.

Cursor solved this for **code**. The equivalent for **prose** is fractured across dozens of partial solutions and not yet won.

---

## Landscape Map (May 2026)

The space is more crowded than it first appears — but no one has the right combination. The landscape is best understood as **five axes**, each with prior art that hits some but never all:

| Axis                 | What it means                                                                    |
| -------------------- | -------------------------------------------------------------------------------- |
| **Storage**          | Where do comments/suggestions live? In the `.md` file, a sidecar, or a database? |
| **Surface**          | CLI, web GUI, native editor, IDE plugin?                                         |
| **AI as peer**       | Can the AI read/write comments and suggestions, not just edit text?              |
| **Locus of control** | Does the human's editor "own" the file, or does the agent's CLI? Or shared?      |
| **Local-first**      | Files on disk, no server, no auth required?                                      |

### Tier 1 — directly overlapping (read these closely)

**`Ch00k/claude-review`** (Go, 17 stars, Nov 2025) — https://github.com/Ch00k/claude-review

- Companion daemon for Claude Code. Browser view of rendered markdown, inline highlight + comment, threaded replies. Two Claude Code slash commands: `/cr-review` (open in browser) and `/cr-address` (Claude fetches comments and addresses them).
- **Storage: SQLite database, not in-file.**
- Surface: browser + Claude Code slash commands.
- **This is the closest thing to "what we'd build."** Watch this project. The Achilles heel is the database — comments are not portable with the file.

**`badlogic/jot`** (TS/JS, 130 stars, active) — https://github.com/badlogic/jot

- Self-hosted markdown editor, "built for humans and agents". CLI for agents (`jot comment`, `jot reply`, `jot resolve`). Real-time collaborative editing (Y.js).
- **Storage: `.json` sidecar is source of truth; `.md` is derived.** Wrong direction for our goal of file-as-truth.
- More ambitious (multi-user, real-time), but agent integration via CLI is the right shape.

**`huyansheng3/markdown-comment` (comment-md)** (TS, 2 stars, active) — https://github.com/huyansheng3/markdown-comment

- A **syntax + parser + plugin ecosystem**, not an app. Defines `<annotation>` and `<comment>` XML-like tags embedded in markdown. Ships remark plugin, React UI, VSCode extension.
- **Storage: in-file.** Has `exportAiView` (strips resolved comments before feeding to LLM) — important pattern.
- No CLI for agents, but the format is right.

**`inkandswitch/tiny-essay-editor`** (TS, Ink & Switch) — https://github.com/inkandswitch/tiny-essay-editor

- Reference markdown editor with inline comments on Automerge CRDT + CodeMirror. Research-quality UX, not built for AI but the editing surface is the gold standard. Backed by **Peritext** CRDT (https://www.inkandswitch.com/peritext/).
- Not actively building toward AI, but the underlying tech is what serious local-first collaboration needs.

### Tier 2 — adjacent but partial

**Nova for Obsidian** (TS, AGPL, paid Supernova tier $29/yr) — https://novawriter.ai/

- "AI plugin for Obsidian that edits your documents directly through natural conversation." Closest to a polished product in the prose space.
- Local AI (Ollama/LM Studio) or API keys (Claude/OpenAI/Gemini). Selection-based editing, prose linter, vault-wide writing score dashboard.
- **No inline comments / suggestions in the doc.** It's a chat sidebar that edits text.
- Strong commercial positioning. Worth studying for UX, but doesn't solve our exact problem.

**Companion for Obsidian** — Cursor-style inline ghost-text autocomplete in Obsidian.

**Cycle / StackEdit / Archbee / MyST Editor / CKEditor AI** — collaborative markdown editors with inline comments + AI features bolted on. All are products with their own format; not local-first; not designed for agents as peers.

**Editmarks (scimax for VSCode)** — plain-text track changes for org-mode/markdown/LaTeX. Validates the in-file approach. Not AI-aware.

**Tina CMS "Markdown Bot"** — GitHub bot that comments on PRs with AI suggestions. Workflow-bound to GitHub.

**Nimbalyst, Ritemark, MD2Doc MCP, Claude Writer's Aid MCP, NoteOperator** — recent "AI-native markdown editor" products. Mostly marketing-heavy and bundle a terminal so Claude Code can sit next to the text. Not contributing new primitives.

### Tier 3 — research and infrastructure

- **Peritext** (Ink & Switch CRDT for rich text with anchored marks) — theoretical foundation.
- **Automerge** — CRDT used by tiny-essay-editor.
- **Yjs** — used by jot for real-time collab.
- **Co-Writing with AI, on Human Terms** (arxiv 2504.12488) — systematic review of 109 HCI papers on AI-assisted writing. Identifies 4 design strategies: structured guidance, guided exploration, active co-writing, critical feedback. Useful for vocabulary; doesn't prescribe an implementation.
- **Interaction-Required Suggestions** (arxiv 2504.08726, Arnold & Kim 2025) — argues for designs that require human involvement at each AI step to preserve agency. Justifies suggestion-mode UX over generative-replacement UX.

### Heat map: who covers what

```
                   In-file  Suggest  Comment  Agent  Local  Active in
                   storage  mode     threads  CLI    first  2025/26
claude-review        ✗        ✗        ✓       ✓ᶜᶜ   ✓       ✓
jot                  ✗        ✗        ✓       ✓     ✓       ✓
comment-md           ✓        ✗        ✓       ✗     ✓       ✓
tiny-essay-editor    ~        ✗        ✓       ✗     ✓       ✓ (slow)
Nova/Obsidian        ✗        ~        ✗       ~ᵐᶜᵖ  ✓       ✓
Cycle/StackEdit      ✗        ✓        ✓       ✗     ✗       ✓
Editmarks            ✓        ✓        ✓       ✗     ✓       ~
```

ᶜᶜ = Claude Code only via slash commands.
ᵐᶜᵖ = MCP, not first-class.
~ = partial.

**No row has all six ticks.** That is the gap.

---

## Where We Fit

The unfilled cell is:

> **In-file storage** + **suggestion mode** + **comment threads** + **agent-agnostic CLI** + **local-first** + **actively built**

This means:

1. **In-file storage** — Comments and suggestions live as embedded tags in the `.md`. The file is source of truth. No sidecar JSON, no SQLite, no server. Round-trips through `git diff`. Survives being viewed in any markdown reader.
2. **Suggestion mode** as a distinct primitive — separate from comments. Proposed edits the human accepts/rejects.
3. **Comment threads** — anchored to text spans, with author + time, resolvable.
4. **Agent-agnostic CLI** — `claude-review` ties itself to Claude Code via slash commands; `jot` requires its own server. Ours is a plain CLI tool any harness (Claude Code, Cursor's agent mode, Aider, custom Lattice agent, anything) can drive with plain file I/O.
5. **Local-first** — no server, no auth, single user + their agents. CRDT and real-time multi-user are explicitly **deferred** to v2.

This is `comment-md`'s format + `jot`'s CLI ergonomics + `claude-review`'s workflow loop, with the agent-coupling and the database removed.

### What we're not building

- A polished GUI editor. The CLI + a side preview HTML page is enough for v0.
- An LLM integration. The tool doesn't call any model. Harnesses call the CLI.
- Real-time multi-user collaboration. Single user + their agents.
- An MCP server. CLI first; an MCP wrapper can come later if useful.
- A replacement for Obsidian/Cursor/Claude Code. A primitive those tools can adopt.

### What we ARE betting on

- **Format > app.** If the format is good and the CLI is small, others adopt it. `comment-md` already proves the format direction; it just lacks the CLI and the workflow opinions.
- **CLI as the agent interface.** The proven shape from `jot` and `claude-review`. Plain file I/O for the human, structured commands for the agent.
- **Markdown stays canonical.** No sidecar, no database. The `.md` is the truth. This is the only way the artifact remains durable beyond the tool's lifespan.

---

## Design Decisions

### 1. Storage: `.md` is source of truth

Comments and suggestions live as embedded tags inside the markdown. Pick syntax that:

- Survives common markdown renderers (GitHub, Obsidian, VSCode preview) without breaking the view
- Is grep-able and human-readable raw
- Round-trips byte-identical for unchanged docs

**Starting position** (test before committing): use HTML comments with structured attributes, since they're invisible in any markdown renderer:

```markdown
The quick brown fox jumps over the lazy dog. <!--mdc:ann id=a1 status=open-->

<!--mdc:comment ann=a1 by=human time=2026-05-21T10:00:00Z
Is "lazy" the right word here?
-->
<!--mdc:comment ann=a1 by=ai time=2026-05-21T10:01:00Z
Consider "sleeping" if the dog is asleep, "lazy" if behaviorally indolent.
-->
```

Or use `comment-md`'s `<annotation>` tag form. Either is defensible. Pick whichever has the cleanest parser story and **commit to it on day one**. Don't bikeshed past day one.

### 2. Suggestion mode is a separate primitive from comments

A **comment** is a discussion. A **suggestion** is a proposed edit (diff) that can be accepted/rejected. Different objects, different UX.

```markdown
The quick brown fox jumps over the lazy dog. <!--mdc:sug id=s1 by=ai

- lazy

* sleeping
  -->
```

`mdc accept <id>` applies the diff and removes the tag. `mdc reject <id>` removes the tag, keeps original. Either way the final file is clean.

### 3. Span addressing by quoted text + stable ID

Line numbers and character offsets break under any edit. Use the quoted text as the human-readable anchor and a stable short ID (6-8 chars, base32) as the durable reference. Both `jot` and `comment-md` do this. Steal it.

When addressing in conversation: `"re: annotation a1f7q3 ('lazy dog')"`.

### 4. Agent interface: plain CLI

```
mdc read <file>            # full doc with all tags
mdc read <file> --clean    # markdown only, comments/suggestions stripped (feed this to LLM)
mdc list <file>            # list all open annotations and suggestions with IDs
mdc comment <file> "quoted text" "comment body" [--reply-to=<id>]
mdc suggest <file> "old text" "new text"
mdc accept <file> <id>
mdc reject <file> <id>
mdc resolve <file> <id>
mdc compact <file>         # strip resolved annotations to keep file tidy
```

That's the agent surface. Plain stdout, exit codes, JSON output flag if needed.

### 5. Human surface: a preview, not a full editor

For v0, `mdc serve <file>` (or `mdc preview <file>`) opens a local web page that:

- Renders the markdown with annotations as inline highlights and a side panel
- Auto-refreshes on file change (the human edits the `.md` in any editor they like — VSCode, Obsidian, vim)
- Lets the human add a comment or suggestion via the UI (which writes back to the `.md`)
- Lets the human accept/reject suggestions with a click

This is exactly `claude-review`'s shape, minus the database, minus the Claude-Code-specific coupling.

### 6. Stack

- **TypeScript** + Node (matches author's preference, fits the markdown tooling ecosystem)
- **Parser:** `remark` + `unified`. `comment-md` already proved this works.
- **Preview server:** small Express/Hono server, file watcher, server-sent events for live refresh
- **Renderer:** `react-markdown` or plain remark→rehype with a custom plugin for our tag syntax
- **No CRDT in v0.** No multi-user. Single writer (the file on disk), one human + agents.
- **Prettier, 2 spaces.**

---

## Open Questions (decide before writing code)

1. **Tag syntax.** HTML comments vs `<annotation>` tags. Test rendering in GitHub, Obsidian, and `glow` first. Pick whichever survives all three cleanly.
2. **ID generation.** UUID is too long for casual reference. Use 6-char base32 (`a1f7q3`) with collision check on insert.
3. **Suggestion conflict policy.** If a suggestion's `old text` no longer matches when accepted (because the surrounding text was edited): fail loud, print the conflict, require manual resolution. Never auto-merge.
4. **Resolved comment policy.** Default: keep in file with `status=resolved` (preserves history). `mdc compact` strips them.
5. **Provenance on the body itself.** Skip in v0. Tracking which spans came from AI vs human is a real problem but adding it now bloats the format. Comments and suggestions carry `by=ai|human`; the document body stays unmarked.

---

## v0 Definition of Done

- `mdc parse fixtures/sample.md` prints AST including annotations and suggestions
- `mdc comment file.md "quoted" "body"` adds a comment, file remains valid markdown
- `mdc suggest file.md "old" "new"` adds a suggestion
- `mdc accept file.md <id>` applies suggestion, removes tag
- `mdc read file.md --clean` returns body with all `mdc:*` tags stripped
- `mdc serve file.md` opens browser preview with inline comments, accept/reject buttons, live reload on file change
- Round-trip property test: `serialize(parse(x)) === x` for fixtures including frontmatter, nested lists, code blocks, tables
- README with one quick start example
- A 5-minute demo: open a `.md` with Claude Code → ask Claude to draft → run `mdc serve` in browser → leave comments → run `claude /address` (slash command we ship) → Claude reads comments, edits + replies → human reviews suggestions, accepts/rejects

That's v0. Use it for two weeks. Then decide what hurts.

---

## How to Work

1. **Don't reimplement what exists.** Read `comment-md`'s remark plugin first. Either depend on it or fork it; don't write a third parser.
2. **Start with the parser + round-trip test.** Everything else builds on it.
3. **CLI before GUI.** Get `comment`, `suggest`, `accept`, `reject`, `read --clean` working with tests before any web UI.
4. **Dogfood early.** Once `comment` and `suggest` work, have Claude Code annotate this very `CONTEXT.md` via the CLI. If the loop feels awkward, fix the CLI first.
5. **Keep the binary small.** Resist database, resist server-side state. Plain file I/O. The `.md` is the database.
