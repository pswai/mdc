---
RFC: 0005
Title: CLI command design — per-command specification
Status: Draft
Author: Engineering Manager (Claude) on behalf of MDC
Created: 2026-05-22
Depends-on: RFC-0001 (CLI surface), RFC-0002 (format syntax), RFC-0003 (impl strategy)
---

# Summary

Per-command specification for the v0 CLI. RFC-0001 §CLI surface defined the commands at the signature level; this RFC locks the implementer-grade depth: exact flags, arg semantics, exit codes, JSON output schema, error taxonomy, and ≥3 examples per command. The Rust CLI PR (backlog Task 5) should have nothing to invent.

The CLI is consumed by **both humans and AI agents** through the same surface (Commitment 3). Conventions here lean toward predictability for agents (stable JSON shapes, semantic exit codes) without sacrificing human ergonomics (clear text mode, sensible defaults).

# Conventions

## Global flags

| Flag                | Meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| `--help` / `-h`     | Print help and exit 0                                           |
| `--version` / `-V`  | Print version and exit 0                                        |
| `--json`            | Machine-readable output (default: human-readable text)          |
| `--quiet` / `-q`    | Suppress non-error output                                       |
| `--no-color`        | Disable ANSI color (default: auto-detect TTY)                   |

All commands accept these. Per-command flags are listed under each command.

## Exit codes

Trimmed taxonomy: every non-zero code carries a **distinct agent-actionable signal**. Grouping (e.g., file-not-found and parse-error both fold into `runtime`) keeps the surface small without losing the distinctions that drive different retry strategies. Inspired by `jq`'s exit-code discipline and the recommendation in `docs/research/0005-cli-conventions.md`.

| Code | Name             | Meaning                                                                                            | Agent's typical response                       |
| ---- | ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 0    | `ok`             | Success                                                                                            | proceed                                        |
| 1    | `runtime`        | Generic runtime failure (file not readable, parse error, I/O error, port bind, etc.)               | inform user, abort                             |
| 2    | `usage`          | Bad args / unknown flag / wrong arity                                                              | reprompt; the command is malformed              |
| 3    | `conflict`       | Old text no longer matches; quoted text appears 0 times or > 1 times — RFC-0001 Decision 3         | re-fetch current state, regenerate the op      |
| 4    | `not-found`      | ID does not exist or refers to wrong kind for the operation                                        | verify ID; perhaps the user typo'd             |
| 5    | `invalid-input`  | User-supplied input contains the forbidden `-->` sequence — RFC-0002 §4                            | re-escape the input, retry                     |

Codes 3 and 5 are the "fail loud" outcomes per RFC-0001 Decision 3 and RFC-0002 §4 respectively.

## `--json` output discipline

- **Single-result commands** (e.g., `mdc accept`, `mdc comment`): emit one JSON object on stdout, newline-terminated.
- **Multi-result commands** (`mdc list`): emit a single envelope `{"items": [...]}` on stdout. **Not NDJSON in v0** — most harnesses default to `JSON.parse(stdout)` and choke on multi-line. NDJSON streaming opt-in (e.g., `--ndjson` flag) is deferred to vNext if v0 dogfooding shows the buffering matters.
- **Errors in `--json` mode**: emit a JSON error envelope on **stdout** (so agents that always parse stdout get a consistent shape on every exit), plus a short human-readable line on **stderr**, plus a non-zero exit code. This matches the `gh` / `npm` convention.

Error envelope (stdout in `--json` mode):

```json
{"error": {"code": "conflict", "message": "old text no longer matches", "at": {"file": "draft.md", "line": 12, "col": 1}, "context": {"expected": "...", "found": "..."}}}
```

`code` is one of the kebab-case names in the exit-code table (`runtime`, `usage`, `conflict`, `not-found`, `invalid-input`). `at` is best-effort; some errors have no useful location.

In **default (text) mode**, errors go to stderr only; stdout stays silent on error.

## Standard input / output / stderr

- All commands take a file path as a positional arg. Where it makes sense, `-` reads from stdin.
- **Stdout is always machine-parseable.** Humans get color and formatting on stderr (progress, hints) in text mode.
- **Color**: auto-detect TTY; `--no-color` overrides; respect `NO_COLOR` env var per [no-color.org](https://no-color.org).
- **Paging**: no auto-paging. Pipe to `less` if you want it.
- **Author tag** (`--by`): commands that write annotations default to `human` unless the `MDC_AUTHOR` env var is set (e.g., to `ai`). Harnesses set this once on shell-out.

## Common JSON shapes

### Annotation

```json
{
  "kind": "annotation",
  "id": "a1f7q3",
  "status": "open",
  "anchor": {
    "text": "the lazy dog",
    "byteOffset": 245,
    "lineRange": [3, 3]
  },
  "comments": [
    {"by": "human", "time": "2026-05-22T10:00:00Z", "body": "Is 'lazy' the right word?"},
    {"by": "ai",    "time": "2026-05-22T10:01:00Z", "body": "Consider 'sleeping' if literal."}
  ]
}
```

### Suggestion

```json
{
  "kind": "suggestion",
  "id": "s1",
  "by": "ai",
  "anchor": {
    "text": "The fox ran away.",
    "byteOffset": 320,
    "lineRange": [5, 5]
  },
  "old": "The fox ran away.",
  "new": "The fox darted into the brush."
}
```

`byteOffset` is the offset of the **anchor tag** in the source. `lineRange` is 1-indexed, inclusive. `anchor.text` is best-effort reconstruction of the annotated span from the source-text-before-the-anchor; consumers should treat it as a hint, not a contract.

## Anchoring conflict + disambiguation

Commands that anchor by quoted body text (`mdc comment`, `mdc suggest`) require the text to identify a **single** location. The default behavior is **fail-loud** when the text appears zero or more than once — never silently pick. This preserves correctness (RFC-0001 Decision 3) but is unforgiving in prose where phrases repeat.

To make ambiguity recoverable in one step, MDC provides:

**1. Disambiguation flags.** Available on `mdc comment` and `mdc suggest`:

| Flag                        | Behavior                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `--line <N>`                | Constrain matches to line N (1-indexed)                                                                   |
| `--occurrence <N>`          | Pick the Nth match (1-indexed), applied **after** other filters                                           |
| `--after "<context>"`       | Match first occurrence whose start byte is **after** the first occurrence of `<context>` in the body      |
| `--before "<context>"`      | Match last occurrence whose end byte is **before** the last occurrence of `<context>` in the body         |
| `--offset <N>`              | Exact byte offset of the match start. Quoted text is **validated** against actual content there (sanity check, not searched). Primary path for agents that have parsed the file |

Flags combine with AND logic. Example: `--line 12 --after "slept"` means "on line 12, after the byte position where 'slept' first appears."

If `--offset N` is given and the byte content at that offset doesn't match the quoted text, exit `3` (conflict) with a "validation failed" message — the agent's offset is stale.

**2. Helpful conflict error.** When the quoted text is ambiguous and no disambiguation flag is given, the error lists every match with line:col + a short context snippet and a hint for which flag to add:

```
mdc: error: conflict — "the fox" appears 3 times in draft.md
  match 1 at draft.md:5:1    "the fox jumped over..."
  match 2 at draft.md:12:8   "...the fox slept while..."
  match 3 at draft.md:18:1   "the fox returned to..."
  hint: disambiguate with --occurrence N, --line N, or --after/--before "<context>"
```

In `--json` mode the matches are surfaced in the error envelope's `context.matches` array:

```json
{"error": {"code": "conflict", "message": "\"the fox\" appears 3 times", "context": {"matches": [
  {"line": 5, "col": 1, "snippet": "the fox jumped over...", "offset": 81},
  {"line": 12, "col": 8, "snippet": "...the fox slept while...", "offset": 245},
  {"line": 18, "col": 1, "snippet": "the fox returned to...", "offset": 422}
]}}}
```

**What is explicitly rejected:**

- *Silent first-match default* (`--first` / "I don't care which") — corrupts correctness for ambiguous cases; if you don't know which span you mean, you don't know what you're commenting on
- *Interactive TTY prompts* — couples to terminal-attached; breaks programmatic invocation and CI tests
- *Fuzzy matching* — silent corruption is worse than a loud error
- *Multi-step API* (`mdc resolve-anchor` → `mdc comment --anchor <id>`) — round-trip waste; the flag set above is cleaner

# Commands

## `mdc read`

```
mdc read <file> [--clean]
```

Print the file's contents to stdout. Default: bytes-exact (round-trip target per RFC-0001 DoD). With `--clean`: strip every `<!--mdc:* -->` tag from the output before printing. Useful for piping into an LLM.

| Arg / Flag    | Semantics                                                                  |
| ------------- | -------------------------------------------------------------------------- |
| `<file>`      | Path to `.md` file, or `-` for stdin                                       |
| `--clean`     | Strip all `mdc:*` tags before output                                       |

Exit codes: `0` ok; `1` runtime (file not readable, parse error if `--clean`).

`--json` is not meaningful for this command; specifying it is a `2` usage error.

**Examples:**

```sh
mdc read draft.md                       # full file with tags
mdc read draft.md --clean               # markdown-only, ready for LLM
mdc read draft.md --clean | claude      # pipe to your harness
mdc read - --clean < draft.md           # via stdin
```

## `mdc list`

```
mdc list <file> [--status <open|resolved|all>] [--kind <annotation|suggestion|all>] [--json]
```

List items in the file. Default text format: one line per item, columns `ID  KIND  STATUS  BY  ANCHOR_PREVIEW`. `--json` emits NDJSON.

| Arg / Flag                          | Semantics                                                             |
| ----------------------------------- | --------------------------------------------------------------------- |
| `<file>`                            | Path to `.md` file                                                    |
| `--status <open\|resolved\|all>`    | Filter by status. Default: `open`                                     |
| `--kind <annotation\|suggestion\|all>` | Filter by kind. Default: `all`                                     |
| `--json`                            | Single envelope `{"items": [...]}` on stdout (see `--json` discipline) |

Exit codes: `0` ok (even when zero items match); `1` runtime.

**Examples:**

```sh
mdc list draft.md                                       # open items, text table
mdc list draft.md --json | jq '.items | length'         # count open threads
mdc list draft.md --status all --kind suggestion        # all suggestions, open or resolved
mdc list draft.md --json --kind annotation | jq '.items[] | .id'   # IDs of open threads
```

## `mdc comment`

```
mdc comment <file> "<quoted-text>" "<body>"
  [--reply-to <id>] [--by <human|ai>] [--json]
  [--line <N>] [--occurrence <N>] [--after "<context>"] [--before "<context>"] [--offset <N>]
```

Anchor a comment to a unique occurrence of `<quoted-text>` in the file body (after MDC tags are stripped for matching). If `--reply-to <id>` is given, the comment is appended to the existing annotation thread rather than creating a new anchor; in this case `<quoted-text>` may be empty (`""`).

If `<quoted-text>` matches zero or more-than-one locations and no disambiguation flag narrows the match to a single one, exit `3` (conflict). The error lists every match with line:col + a context snippet — see §Anchoring conflict + disambiguation.

| Arg / Flag                | Semantics                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `<file>`                  | Path                                                                                     |
| `<quoted-text>`           | Body text to anchor to. Empty string allowed only with `--reply-to`                      |
| `<body>`                  | Comment body. May contain newlines (use shell heredocs or `$(< file)`)                   |
| `--reply-to <id>`         | Append to existing annotation with this ID instead of creating a new anchor              |
| `--by <human\|ai>`        | Author tag. Default: `MDC_AUTHOR` env var if set, else `human`                           |
| `--line <N>`              | Constrain match to line N (1-indexed). See §Anchoring conflict + disambiguation          |
| `--occurrence <N>`        | Pick the Nth match (1-indexed) after other filters                                       |
| `--after "<context>"`     | Match first occurrence after the first occurrence of `<context>` in the body             |
| `--before "<context>"`    | Match last occurrence before the last occurrence of `<context>` in the body              |
| `--offset <N>`            | Exact byte offset; quoted text validated against the byte content there. Agent-primary   |
| `--json`                  | Print the resulting Annotation JSON on stdout                                            |

Exit codes: `0` ok; `1` runtime; `3` conflict (quoted text not unique, or `--offset` validation failed); `4` not-found (reply-to id missing) or wrong-kind (reply-to refers to a suggestion); `5` invalid-input (`-->` in `<body>`).

**Examples:**

```sh
# Unique anchor — works as before
mdc comment draft.md "the lazy dog" "Consider 'sleeping' if literal."

# Reply to existing thread (no anchor concern)
mdc comment draft.md "" "follow-up" --reply-to a1f7q3

# Ambiguous "the fox" — disambiguate by line
mdc comment draft.md "the fox" "consider rewrite" --line 12

# Disambiguate by surrounding context
mdc comment draft.md "the fox" "consider rewrite" --after "slept while"

# Pick the second occurrence
mdc comment draft.md "the fox" "consider rewrite" --occurrence 2

# Agent path: byte offset from a prior parse, text validated
mdc comment draft.md "the fox" "rewrite" --offset 245 --by ai

# Long body from file, with disambiguation
MDC_AUTHOR=ai mdc comment draft.md "the fox" "$(< thoughts.md)" --line 12 --json
```

## `mdc suggest`

```
mdc suggest <file> "<old-text>" "<new-text>"
  [--by <human|ai>] [--json]
  [--line <N>] [--occurrence <N>] [--after "<context>"] [--before "<context>"] [--offset <N>]
```

Add a suggestion replacing `<old-text>` with `<new-text>`. `<old-text>` must identify a single occurrence in the body (after MDC tag-strip). Disambiguation flags work as on `mdc comment` — see §Anchoring conflict + disambiguation. Wire format follows RFC-0002 §5 (`old:` / `new:` blocks).

| Arg / Flag                | Semantics                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `<file>`                  | Path                                                                                     |
| `<old-text>`              | Body span to replace. Must identify a unique occurrence (use disambiguation flags if not) |
| `<new-text>`              | Replacement text. May be empty (= pure deletion)                                         |
| `--by <human\|ai>`        | Author tag. Default: `MDC_AUTHOR` env var if set, else `human`                           |
| `--line <N>`              | Constrain match to line N                                                                |
| `--occurrence <N>`        | Pick the Nth match (1-indexed) after other filters                                       |
| `--after "<context>"`     | Match first occurrence after the first `<context>`                                       |
| `--before "<context>"`    | Match last occurrence before the last `<context>`                                        |
| `--offset <N>`            | Exact byte offset; old text validated against actual content                             |
| `--json`                  | Print the resulting Suggestion JSON on stdout                                            |

Exit codes: `0` ok; `1` runtime; `3` conflict (old text not unique, or `--offset` validation failed); `5` invalid-input (`-->` in old/new).

**Examples:**

```sh
# Unique old text — works as before
mdc suggest draft.md "The fox ran away." "The fox darted into the brush."

# "didnt" appears many times; target one occurrence by line
mdc suggest draft.md "didnt" "didn't" --line 42

# Agent path with byte offset, text validated for safety
mdc suggest draft.md "didnt" "didn't" --offset 1280 --by ai

# Pure deletion of a duplicate sentence on a specific line
mdc suggest draft.md "extra paragraph to remove" "" --line 27

# Long old/new via files, disambiguated by context
mdc suggest draft.md "$(< old.txt)" "$(< new.txt)" --after "Section 3" --by ai
```

## `mdc accept`

```
mdc accept <file> <id> [--json]
```

Apply the suggestion identified by `<id>`: replace the `old` text in the body with `new`, then remove the suggestion's `<!--mdc:sug-->` tag. The file is byte-stable except for the replaced span and the removed tag.

If the `old` text no longer matches the current body (because the surrounding text was edited concurrently), exit `3` and print a unified diff of `expected` vs `found` to stderr. **Never auto-merge** — RFC-0001 Decision 3.

| Arg / Flag | Semantics                                                            |
| ---------- | -------------------------------------------------------------------- |
| `<file>`   | Path                                                                 |
| `<id>`     | Suggestion ID                                                        |
| `--json`   | Emit `{"applied": "<id>"}` on success                                |

Exit codes: `0` ok; `1` runtime; `3` conflict (old text no longer matches); `4` not-found / wrong-kind.

**Examples:**

```sh
mdc accept draft.md s1
mdc accept draft.md s1 --json
mdc accept draft.md s2 || echo "conflict — inspect with mdc list"
```

## `mdc reject`

```
mdc reject <file> <id> [--json]
```

Remove the suggestion's tag from the file; keep the original `old` text in place. The file body is byte-identical to its state before the suggestion was added (modulo any other edits since).

| Arg / Flag | Semantics                                  |
| ---------- | ------------------------------------------ |
| `<file>`   | Path                                       |
| `<id>`     | Suggestion ID                              |
| `--json`   | Emit `{"rejected": "<id>"}` on success     |

Exit codes: `0` ok; `1` runtime; `4` not-found / wrong-kind.

**Examples:**

```sh
mdc reject draft.md s1
mdc reject draft.md s1 --json
```

## `mdc resolve`

```
mdc resolve <file> <id> [--json]
```

Mark an annotation as resolved. The annotation stays in the file with `status=resolved` (RFC-0001 Decision 4). `mdc compact` later strips resolved annotations. Only works on `mdc:ann` (annotations with threaded comments); rejecting a comment or suggestion uses the kind-specific commands above.

| Arg / Flag | Semantics                                  |
| ---------- | ------------------------------------------ |
| `<file>`   | Path                                       |
| `<id>`     | Annotation ID                              |
| `--json`   | Emit `{"resolved": "<id>"}` on success     |

Exit codes: `0` ok; `1` runtime; `4` not-found / wrong-kind.

**Examples:**

```sh
mdc resolve draft.md a1f7q3
```

## `mdc compact`

```
mdc compact <file> [--json]
```

Strip every annotation with `status=resolved` from the file. Open annotations and standalone suggestions are untouched. The output is still valid markdown.

| Arg / Flag | Semantics                                       |
| ---------- | ----------------------------------------------- |
| `<file>`   | Path                                            |
| `--json`   | Emit `{"removed": ["a1f7q3", "a2x9k1", ...]}`   |

Exit codes: `0` ok; `1` runtime.

**Examples:**

```sh
mdc compact draft.md
mdc compact draft.md --json | jq '.removed | length'
```

## `mdc serve`

```
mdc serve <file> [--port <n>] [--bind <addr>] [--no-open]
```

Start a local HTTP server that renders the file with annotation UI, watches the file for changes, and pushes updates over SSE. The browser opens automatically unless `--no-open` is set. See **RFC-0006** for the browser-UI specification.

| Arg / Flag         | Semantics                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `<file>`           | Path                                                                                                            |
| `--port <n>`       | Bind port. Default `8421`. If port is taken, try `8422`, `8423`, … up to 8430 before erroring                   |
| `--bind <addr>`    | Bind address. Default `127.0.0.1`. Setting `0.0.0.0` requires `--bind 0.0.0.0` explicitly (never assumed)       |
| `--no-open`        | Do not auto-open the browser                                                                                    |

Exit codes: `0` on `SIGINT` / `SIGTERM` (clean shutdown); `1` runtime (file not readable, bind failed after port retries).

**Security default:** `127.0.0.1` only. The server has no auth; binding to `0.0.0.0` exposes the file to anyone on the network. Requires explicit opt-in via `--bind 0.0.0.0`.

**Examples:**

```sh
mdc serve draft.md                              # open browser on http://127.0.0.1:8421
mdc serve draft.md --port 9000 --no-open
mdc serve draft.md --bind 0.0.0.0 --port 9000   # expose to LAN (explicit, no default)
```

## `mdc parse` (debug)

```
mdc parse <file> [--json]
```

Print the parsed AST. **Output shape is not stable across versions** — this command exists for debugging the parser and writing test fixtures. Production callers should use the structured commands (`list`, `read`).

| Arg / Flag | Semantics                                            |
| ---------- | ---------------------------------------------------- |
| `<file>`   | Path                                                 |
| `--json`   | JSON output (default in v0). Text mode is a tree     |

Exit codes: `0` ok; `1` runtime.

**Examples:**

```sh
mdc parse fixtures/parser/basic.md
mdc parse fixtures/parser/basic.md --json | jq '.annotations | length'
```

# Error message style

**Text mode** (stderr):

```
mdc: error: <code> — <short reason>
  at <file>:<line>:<col>
  <context: expected vs found, suggestion, etc.>
```

Examples:

```
mdc: error: conflict — old text no longer matches
  at draft.md:5:1
  expected: "The fox ran away."
  found:    "The fox slipped into the brush."
  hint: the surrounding text was edited; review with `mdc list draft.md` and either edit the file to restore the old span or `mdc reject` this suggestion.
```

```
mdc: error: conflict — "the fox" appears 3 times in draft.md
  match 1 at draft.md:5:1    "the fox jumped over..."
  match 2 at draft.md:12:8   "...the fox slept while..."
  match 3 at draft.md:18:1   "the fox returned to..."
  hint: disambiguate with --occurrence N, --line N, or --after/--before "<context>"
```

**JSON mode** (stderr): the error envelope shape under §`--json` output discipline.

Every error message must:

1. Start with `mdc: error: <code>` (text mode) or set `error.code` (JSON mode) — code from the kebab-case taxonomy in §Exit codes (`runtime`, `usage`, `conflict`, `not-found`, `invalid-input`)
2. Be ≤ 80 chars on the first line so it lines up in narrow terminals
3. Include `at <file>:<line>:<col>` when a location is meaningful
4. Suggest the next action when possible (the `hint:` line in the example above)
5. In `--json` mode: the envelope goes to **stdout** with the short line still on stderr, so agents that always parse stdout get a consistent shape on every exit (`gh` / `npm` convention)

# Discovery

v0 ships:

- `mdc --help` — global help, lists commands with one-line synopses
- `mdc <command> --help` — per-command help, full usage
- `mdc --version` — version (matches `mdc-core` and `@mdc/parser` per RFC-0003 coordinated versioning)

No interactive prompts. No first-run wizard. (Onboarding affordances live in RFC-0004.)

# Definition of done

This RFC moves to `Accepted` when:

- [ ] Every v0 command listed in RFC-0001 §CLI surface has synopsis, args, flags, exit codes, JSON shape, ≥ 3 examples
- [ ] Exit-code taxonomy is consistent across commands
- [ ] Common JSON shapes (Annotation, Suggestion) are locked
- [ ] Error message style is uniform
- [ ] CLI conventions research at `docs/research/0005-cli-conventions.md` reviewed and reconciled (any divergence from common patterns is justified, not accidental)
- [ ] Independent reviewer subagent passes the RFC
- [ ] User accepts

# References

- RFC-0001 §CLI surface (capability-level command list)
- RFC-0002 §1 (HTML-comment syntax), §3 (ID format), §5 (suggestion body)
- RFC-0003 §Test bar (`assert_cmd` CLI integration tests are how this RFC is verified)
- Pending research: [`docs/research/0005-cli-conventions.md`](../research/0005-cli-conventions.md)
