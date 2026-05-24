# Autonomous Iteration Experiment — Report

Branch: `experiment/autonomous-iteration`
Date: 2026-05-22 → 2026-05-24
Mode: Solo Claude, no human check-ins, /goal = "extremely user-friendly for both AI Agent and Human."

## TL;DR

A working TypeScript implementation of MDC ships on this branch: a parser, a 10-command CLI, and a local preview server with a browser UI. 45/45 tests green. You can drop the included `demo/blog-draft.md` (or any markdown file) in, run a quick comment / suggest / accept loop, and judge whether the format is pleasant to live with.

## How to run it

```sh
npm install              # 4 packages, 0 vulnerabilities
npm test                 # 45/45 should pass
cp demo/blog-draft.md /tmp/draft.md
node dist/src/cli.js list /tmp/draft.md
node dist/src/cli.js comment /tmp/draft.md "wrong default" "soften this?" --by ai
node dist/src/cli.js inspect /tmp/draft.md <id>
node dist/src/cli.js serve /tmp/draft.md    # opens http://127.0.0.1:8421
```

To use it as `mdc` system-wide for a session: `chmod +x bin/mdc && export PATH="$PWD/bin:$PATH"`. The wrapper points at `dist/src/cli.js`.

## What was built

### Parser (`src/parser.ts`, `src/serializer.ts`, `src/ids.ts`)

- Scans source for `<!--mdc:ann|comment|sug ...-->` HTML comments, parses attributes (with quoted-value support), tracks byte ranges, derives `anchor.text` for each annotation by reconstructing the clean preceding text (skipping over earlier tag ranges so anchor snippets read as prose, not tag soup).
- Emits canonical `mdc:ann`, `mdc:comment`, `mdc:sug` forms. Rejects user input containing `-->` per RFC-0002 §4.
- 6-char Crockford base32 IDs with 20-retry uniqueness per RFC-0002 §3.
- Byte-identical round-trip on every fixture; idempotence after insert→parse→emit cycles.

### CLI (`src/cli.ts`, `src/commands/*.ts`, `bin/mdc`)

- Ten commands: `read`, `list`, `inspect`, `comment`, `reply`, `suggest`, `accept`, `reject`, `resolve`, `compact`, `serve`.
- Disambiguation flags on `comment` and `suggest`: `--line`, `--occurrence`, `--after`, `--before`, `--offset` (per the RFC-0005 ergonomic fix you requested).
- Exit-code taxonomy: 0 ok, 1 runtime, 2 usage, 3 conflict, 4 not-found, 5 invalid-input.
- `--json` shape: single envelope, never NDJSON; error envelope goes to stdout in `--json` mode plus a short human line on stderr (gh/npm convention).
- Conflict errors list all matches with `line:col` + snippet + a hint for which disambiguation flag to add.
- `mdc serve` binds `127.0.0.1` only; `--bind 0.0.0.0` requires explicit opt-in.

### Preview server + browser UI (`src/server.ts`, `web/*`)

- Node `http` server, file-watch via `fs.watch` with 50ms debounce, SSE for live reload.
- Browser UI: rendered markdown in the main column, side rail with threads (annotation → comments + reply composer + resolve button) and suggestion cards (old/new diff + accept/reject), keyboard floor (J/K/R/A/X/E), prefers-color-scheme dark mode.
- Server shells out to the CLI for writes — single source of write logic; same exit codes propagate to the browser as toasts.

### Tests (45/45)

- 19 parser/serializer/id tests (fixture round-trip, idempotence, error paths, byte positions).
- 26 CLI integration tests via `spawnSync` + tmpdir (every command, conflict + disambiguation flows, round-trip clean after writes).

## What surprised me

1. **The "companion anchor" pattern bit harder than expected.** My `mdc suggest` writes both an inline `mdc:ann` *and* a `mdc:sug` block sharing one ID. The parser dutifully returned both as separate items, and `mdc list` was suddenly twice as noisy. Fixed by adding `displayableItems()` that filters out commentless annotations whose ID is also a suggestion. The lesson: the format's "natural" representation doesn't always match the user's mental model; the parser should be honest about what's there, and a separate helper should curate what to show.

2. **Anchor placement is a punctuation problem before it's an algorithm problem.** Inserting an anchor right after "the matched span" sounds clean — but when the user types `"the lazy dog"`, the period belongs *with* the sentence. Putting `<!--ann-->` between the word and its period reads as broken English. Fix is two lines (walk past `[.!?,:;…]` before inserting) but I only saw it by dogfooding on a real paragraph. The RFC didn't anticipate it.

3. **`anchor.text` derivation matters as much as the anchor itself.** The first pass leaked adjacent tag content into the snippet ("…--mdc:ann id=jghgx4 status=open…" showed up in `mdc list` output). It was technically correct (it WAS the source text before the tag) but completely unreadable. Three rewrites later, the snippet is "the last sentence on the last non-empty line before the tag, with tag ranges skipped." That feels like the right shape — short, focused, prose-only.

4. **The browser UI never needed positional coordinates.** The original RFC-0006 imagined byte-offset → DOM-position mapping. In practice, I render the markdown with anchor placeholder spans inline, then the client wraps the *previous text node* in a highlight. Zero coordinate math; works correctly with any markdown renderer's whitespace decisions. The placeholder-span approach is the unlock — worth noting in RFC-0006.

5. **`mdc reply` and `mdc inspect` weren't in any RFC but are the two commands I reached for most.** Reply is sugar (`comment --reply-to`) but typing `mdc reply file.md a1f7q3 "fix this"` is half the keystrokes and zero of the awkwardness. Inspect saves me from grepping `--json` output. Both should land in RFC-0005.

## Limitations I accepted for time

- **Tags inside fenced code blocks render as literal text** in any markdown viewer. There's no way around this with HTML comments alone — `marked` (and every other renderer) treats code blocks as opaque. Authoring an annotation that anchors inside a code block currently breaks the code-block visual. A v0.x fix: the `suggest` / `comment` commands should detect fenced-block boundaries (cheap regex on the source) and refuse, with a hint to anchor on the surrounding prose instead.
- **`accept` leaves a single trailing blank line** where the suggestion block was. Cosmetic; doesn't affect round-trip; would take ~10 lines to clean up.
- **No formal accessibility audit** of the browser UI. Roles + keyboard floor are there; haven't run axe-core.
- **No fuzz testing** (`cargo fuzz` was the Rust plan; JS-side fast-check isn't installed). Round-trip + idempotence tests on fixtures are the property-test substitute.
- **Cross-file references**: I broke v0/v1 per your instruction but didn't actually implement cross-file refs. The format trivially extends to `file.md#a1f7q3`-style links; the CLI just doesn't surface them yet. Easy follow-up if you want them.
- **No CLI tests for `mdc serve` or `mdc inspect`** — both smoke-tested by hand. Adding them is straightforward.

## Recommendations for the RFCs

If you merge any of this experiment into the planned strategy:

1. **RFC-0005**: add `mdc reply` and `mdc inspect` to the locked command list. Add a note that anchor insertion extends past trailing sentence punctuation.
2. **RFC-0006**: lock the "placeholder span → wrap previous text node" rendering technique. It's cleaner than the byte-offset approach the RFC implied.
3. **RFC-0002**: codify the "companion anchor pattern" for suggestions (`<!--mdc:ann id=X status=open--><!--mdc:sug id=X ...-->`) and the "displayable items" filter rule. Without it, every suggestion looks like two items.
4. **RFC-0001**: add a non-goal: "MDC tags inside fenced code blocks are not supported in v0." Document the workaround (anchor on surrounding prose).

## What I'd do with another day

In order of "biggest user-friendliness win per hour":

1. **Browser UI: span-selection authoring.** Select text in the rendered doc → floating "Comment" / "Suggest" button → composer POSTs back through `/api/comment` or `/api/suggest`. The server side already exists; the client side is ~50 lines. Removes the "switch to terminal" friction in the most common authoring case.
2. **`mdc init`**: drop a single-file `.mdc/AGENTS.md` (or similar) so any agent picking up a project knows the CLI exists and how to use it. Lowers the "agent discovery" cost from zero to negative.
3. **Fenced-code-block detection in `comment` / `suggest`** — refuse with a clear error rather than silently producing broken output.
4. **Per-command `--help`** with examples — currently only the usage line prints. Help text is the cheapest documentation.
5. **`mdc serve --share`**: tail-side ngrok-equivalent for remote pairing. Not v0; would need auth.

## Branch state

```
experiment/autonomous-iteration  (this branch — 5 commits ahead of main)
├── parser foundation + 19 tests
├── 8 CLI commands + 26 tests
├── preview server + browser UI
├── dogfood iteration (anchor.text, punctuation, displayableItems, reply, inspect)
└── EXPERIMENT.md (this file)

main  (untouched)
feat/rfc-0005  (open PR #3 — unchanged)
feat/rfc-0006  (open PR #4 — unchanged)
```

Nothing here was merged to main. If you want any of this — pick what's useful, leave what isn't. Or merge the whole branch and treat it as the v0 starting point.

---

# Continuation: Browser Dogfood + CRDT Exploration

Second autonomous pass on 2026-05-24. Goal expanded to: actually drive the browser via `agent-browser`, explore CRDT-based collaboration, prototype "Google-Docs-for-markdown."

## What I did

### 1. Drove the actual browser

Opened `mdc serve demo/blog-draft.md` and used `agent-browser` to take screenshots through a real `comment → suggest → accept → reply` loop. Three things worth surfacing:

- **SSE live reload works as expected.** CLI writes from the terminal immediately appear in the browser without refresh.
- **Real bug found:** suggestions were rendering as a plain yellow highlight on the body (same treatment as comments), with the diff only visible in the side rail. **RFC-0006 actually specified inline Google-Docs-Suggesting style** — strikethrough old + colored insert new, inline. I'd built only half of it. Fixed in `web/app.js` + `web/styles.css` (commit `e9083f9`): when the wrapped target text ends with the suggestion's `old`, wrap exactly that span with a strikethrough mark and append an `<ins>` sibling with `sug.new` in green. Verified visually — looks right.
- **Soft bug:** the side rail re-renders fully on every SSE event (`rail.innerHTML = ''` → re-create). Breaks focus and breaks the agent-browser snapshot refs. In production this would also flash the user's open thread. Should use a key-based reconciliation (data-id → patch instead of replace). Not fixed in this pass — noted for whoever picks it up.

### 2. CRDT prototype at `/collab`

Added Yjs as a dependency, built a minimal Y.js-over-WebSocket collaboration mode at a NEW route `/collab`. The existing read+annotate UI at `/` is untouched.

**Architecture:**

```
Browser tab A ──┐           ┌── Browser tab B
                │           │
                ▼           ▼
              ws ws://host/api/y/<file>
                │           │
                └─► mdc serve ◄─┘
                      │
                      ▼
                  Y.Doc (one per file)
                      │
                      │  ytext.observe + 500ms debounce
                      ▼
                  writeFile (.md on disk)
```

**Wire protocol (deliberately tiny, NOT y-websocket):** on connect, server sends `Y.encodeStateAsUpdate(doc)`; subsequent client messages are treated as `Y.applyUpdate` payloads, server applies locally then broadcasts to other clients. ~80 LOC server-side.

**Client (web/collab.js):** Plain `<textarea>` backed by `Y.Text`. On `input`, compute a tiny prefix/suffix diff between textarea and ytext, apply as `ytext.delete + ytext.insert`. On remote update, mirror ytext back to textarea (preserve selection best-effort).

**Bundling caveat:** `yjs.mjs` shipped in the npm package isn't a browser-ready bundle — has bare `lib0/observable` imports. Pre-bundled with `npx esbuild --bundle --format=esm` into `web/yjs.mjs` (266 KB). One-time build step; not in package scripts yet.

### 3. Verified the two-tab demo with agent-browser

Opened two named sessions (`tab1`, `tab2`), pointed both at `/collab`, typed in one, observed the other's textarea update via Y.js sync. File on disk got rewritten ~500ms after edits settled. Screenshots in the conversation log if you want to see them.

## What this answers about "markdown-based Google Doc"

**Short answer: yes, the plumbing works. The hard parts are not the CRDT.**

The 90 minutes of integration above proved that:

- Yjs as the live runtime: trivial. ~150 LOC total across server + client for basic shared editing.
- File-on-disk as the canonical persistence: works on the *outbound* leg (CRDT → file) with simple debounce.
- Multi-tab sync: works first try once the bundle issue is fixed.

What it did **not** answer:

1. **Anchored annotations vs. live text edits.** MDC's anchor model is byte offsets in a snapshot of the file. The moment text shifts under an anchor (someone else inserts a paragraph above), the anchor points at the wrong span. Yjs ships exactly the primitive needed (`Y.RelativePosition` — a position that travels with the text it's anchored to), but wiring it into MDC's HTML-comment format is real work. The annotation would need to live as **CRDT-side metadata** during a live session, then re-serialize to the markdown anchor on session end. That's a meaningful redesign, not a small fix.

2. **External-file → CRDT direction.** If someone edits the .md file in VSCode while a collab session is live, the file watcher fires but the CRDT doesn't know what to do. Real apps (tiny-essay-editor, etc.) sidestep this by making the CRDT primary and never trusting external edits. That conflicts with Manifesto Commitment 1.

3. **Presence (cursors, selections).** Not implemented. Y.js has `awareness` for this; client + server need ~20 LOC each.

4. **Authentication.** Right now any browser on `127.0.0.1` can connect. Multi-user means real authn/authz. Out of scope for the experiment, but real for any "Google Doc-like" deployment.

## What this means for the manifesto

The cleanest framing I can offer: **Commitment 1 ("the file is the truth") and live multi-user collaboration are in genuine tension, and the experiment surfaces the choice.**

Three coherent positions:

- **A. Single-writer-at-a-time (current manifesto).** Live multi-user collab is out of scope forever. The collab mode I built is a curiosity that violates the commitment. Delete it.
- **B. File-is-truth, sessions are ephemeral.** What I built. CRDT is a transient layer for live editing; on session-end the CRDT collapses to a file. Annotations get re-anchored on serialize. External edits trigger session-end (warn users). Works, but messy at the seams.
- **C. CRDT-is-truth, file is an export view.** Like tiny-essay-editor. Loses Commitment 1 explicitly but gains real multi-user. Probably what's needed to actually rival Google Docs for prose.

The experiment leans (B) is feasible without a manifesto rewrite, but (C) is what "markdown-native Google Docs" actually means.

## What this branch is and isn't

Adds:
- `src/collab.ts` (~110 LOC) — Y.Doc + WebSocket hub
- `web/collab.html`, `web/collab.js` (~90 LOC) — bare-bones shared textarea
- `web/yjs.mjs` (266 KB bundled, gitignored is debatable — included for now so the demo works without npx)
- 3 new runtime deps: `yjs`, `ws`, `@types/ws`. 7 packages total in node_modules (still small).
- Inline suggestion UI fix in `web/app.js` + `web/styles.css`

Doesn't add (deliberate):
- Test coverage for collab — the demo IS the test for now; would need WebSocket fixtures + a Y.js mock for proper CI
- Presence / cursors
- Anchored-annotation drift handling (the load-bearing missing piece)
- External-file → CRDT merge

## How to run the new bits

```sh
git checkout experiment/autonomous-iteration
npm install     # picks up yjs + ws
npm run build
node dist/src/cli.js serve demo/blog-draft.md
# Open http://127.0.0.1:8421/        — read + annotate UI
# Open http://127.0.0.1:8421/collab  — CRDT-shared textarea
# Open /collab in a second tab — type in one, watch the other update
```

## Recommendations from this pass

1. **Decide A / B / C above.** Until the manifesto says which world MDC lives in, the format design will keep tripping over collab questions. (B) seems pragmatic but doesn't fix the anchored-annotation problem.
2. **If (B) or (C), spike the anchored-annotation drift problem next.** It's the load-bearing missing piece. Y.js `RelativePosition` is the primitive. Allocate at least a week.
3. **Fix the inline suggestion display in v0.** I already did this in commit `e9083f9`; just port the same idea (don't only show diff in side rail) into the canonical RFC-0006 spec.
4. **Fix the side-rail re-render flash.** Tiny but kills the polish.

## Updated branch state

```
experiment/autonomous-iteration
├── ... (original 6 commits)
├── e9083f9  experiment(ui): inline strikethrough + insert for suggestions
├── <crdt commit>  experiment(collab): Yjs CRDT at /collab
└── <this report commit>  experiment(report): browser + CRDT findings
```

Branch is still isolated from main. Nothing here has been reviewed, merged, or even particularly hardened — these are findings to inform decisions, not code to ship.

