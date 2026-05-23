# Research: CLI conventions for hybrid (human + agent) tools

For RFC-0005. Ran each tool locally + read help/man pages. "Verified" = executed; "Source" = read only.

## 1. `gh` (2.x). Sources: `gh pr view --help`, `gh help formatting`, `gh help exit-codes`.

- **`--json`** = comma-separated field allowlist; bare `--json` lists fields. Reshape via `--jq` / `--template`. Single JSON value, not NDJSON (verified).
- **Errors.** `gh api` writes upstream JSON to **stdout**, human line to **stderr**, exit 1 (verified). Non-`api` `--json` commands emit no JSON on error — stderr only.
- **Exit codes.** `0` ok, `1` general, `2` cancelled, `4` auth. Flags: long primary; `--foo value` and `--foo=value` both accepted.

## 2. `cargo` (1.x)

- **`cargo metadata --format-version 1`** → single object on stdout; `--format-version` is the forward-compat lever.
- **`cargo build --message-format=json[-...]`** → **NDJSON**, one object per line discriminated by `"reason"` (`compiler-artifact`, `compiler-message`, `build-finished`). Streamed (verified). Diagnostics are stream records; terminal `{"reason":"build-finished","success":false}` + nonzero exit. No separate envelope.
- **Exit codes.** `0` success, `101` panic, otherwise nonzero; no finer taxonomy.

## 3. `npm` (11.x)

- **`npm view --json` / `install --json`** → single value on stdout (verified).
- **Error envelope** (verified): `{ "error": { "code": "E404", "summary": "...", "detail": "..." } }` on stdout, human log to stderr.
- **Exit codes.** `0`/`1` only; finer detail in `error.code` strings.

## 4. `git`

- **`--porcelain[=v1|v2]`** = stable text (not JSON); contract: stable across versions regardless of user config (`git status --help`).
- **`--exit-code` predicate**: `git diff --exit-code` → `0` no diff, `1` diff exists. Query doubles as predicate.
- **Plumbing** (`ls-files`, `cat-file`) is the agent-facing surface with stability guarantees; porcelain retrofits via the flag.

## 5. `jq` (1.7) — gold-standard exit codes (`man jq`)

`0` ran, last value truthy; `1` last value `false`/`null`; `2` usage/system error; `3` jq compile error; `4` `-e` and no output; `5` default for `halt_error`.

---

# Recommendation for MDC

1. **NDJSON for streams, single object for snapshots.** `mdc list --json` → NDJSON, one record per line with `"kind"` discriminator (cargo's `"reason"`). `mdc read --json` → single object. Why: the agent loop is fetch-open → act on one → repeat; NDJSON streams and composes (`head`/`grep`); a single array forces buffering.
2. **JSON error envelope on stdout in `--json` mode, human line on stderr** (gh + npm): `{ "error": { "code": "E_CONFLICT", "message": "..." } }`, nonzero exit. Default mode: stderr only, no fake envelope.
3. **Exit-code taxonomy** (jq-shaped): `0` success; `1` runtime failure (parse error, suggestion conflict, file unreadable); `2` usage error — separates "command malformed" from "file said no"; `3` not-found *result* (e.g., `mdc list --id=X` missing), predicate-style; `4` reserved (gh's auth slot).
4. **Surface discipline.** Long flags primary, `--foo bar` and `--foo=bar` both accepted; short only for top 3–4. Stdout is data, stderr is chatter; never auto-page; TTY detection only colorizes. `-` as filename = stdin (cargo-shaped); never read stdin when given a path.

**Unverified.** Whether Claude Code / Cursor parse NDJSON cleanly — may default to `JSON.parse(stdout)` and choke on multi-line. 30-min spike before locking. Fallback: single `{ "annotations": [...] }` object.
