---
Research: 0003
Title: Rust markdown library for `mdc serve` preview pipeline
Status: Complete
Created: 2026-05-21
Scope: Renderer only. MDC parser is markdown-agnostic per RFC-0002.
---

# Use case

`mdc serve` renders markdown -> HTML, then post-processes to inject annotation UI. MDC tags are located by text scan + byte positions; no AST work on MDC tags needed. Requirements: GFM, frontmatter handling, ideally code-block syntax highlighting.

# Candidates

## 1. `comrak` (kivikakk/comrak)

- License: BSD-2-Clause (`Cargo.toml`, `COPYING`). GitHub API says `NOASSERTION` due to a custom header — ignore.
- Maintenance: `v0.52.0` 2026-04-04; commit 2026-05-19. Active.
- GFM: 670/670 tests (README badge). Tables, autolinks, task lists, strikethrough, footnotes, plus math/alerts/wikilinks.
- Frontmatter: First-class `Options::extension.front_matter_delimiter`.
- AST vs events: Arena AST (`parse_document` -> `&AstNode`), confirmed in `src/lib.rs:21-49`, `src/nodes.rs`, `src/arena_tree.rs`. Also a `markdown_to_html` one-liner.
- Syntax highlighting: Built-in `syntect` plugin (`src/plugins/syntect.rs`, default-on).
- Dep weight: Direct (Cargo.toml): `typed-arena`, `caseless`, `jetscii`, `phf`, `rustc-hash`, `smallvec`, `finl_unicode`; optional `syntect`, `clap`, `emojis`, `bon`. `syntect` pulls `onig`. Small with `default-features = false`.
- API: `comrak::markdown_to_html(src, &Options::default())`.

## 2. `markdown-rs` (wooorm/markdown-rs, crate `markdown`)

- License: MIT.
- Maintenance: `1.0.0` 2025-04-23; **latest commit on `main` also 2025-04-23**; 34 open issues. 13 months idle.
- GFM: Claimed "100% GFM"; frontmatter + math also listed (README — not exercised).
- AST vs events: `mdast` AST matching JS `remark` (`src/mdast.rs`, `src/to_mdast.rs`).
- Syntax highlighting: None built-in.
- Dep weight: Tiny — `unicode-id` (+ optional `log`/`serde`).
- API: `markdown::to_html_with_options(src, &Options::gfm())`.

## 3. `pulldown-cmark` (pulldown-cmark/pulldown-cmark)

- License: MIT.
- Maintenance: `v0.13.4` 2026-05-20; commit 2026-05-13. Active, steady.
- GFM: Tables, task lists, strikethrough, footnotes via `Options` flags. Autolink completeness not verified vs GFM corpus.
- Frontmatter: **None** — no `front_matter` symbol, no README mention. We'd strip it ourselves.
- AST vs events: Streaming `Event` iterator only — no AST. Explicit design choice.
- Syntax highlighting: None built-in; intercept `Event::Start(CodeBlock)` and call `syntect`.
- Dep weight: Smallest. Direct: `bitflags`, `unicase`, `memchr`; optional `serde`, `pulldown-cmark-escape`, `hashbrown`.
- API: `let p = Parser::new_ext(src, opts); html::push_html(&mut out, p);`

# Recommendation: `comrak`

Comrak is the **only** candidate shipping GFM + frontmatter + syntect in one configurable call — the exact v0 pipeline — saving us from owning a frontmatter stripper and a syntect bridge. BSD-2-Clause suits static-binary distribution; the arena AST is bonus surface for later (e.g., nav generation). `markdown-rs` is disqualified on the **maintenance signal alone**: 13 months idle is not a foundation for a "distribute everywhere" CLI (Commitment 2). `pulldown-cmark` is the fallback **if** comrak's `syntect` -> `onig` chain proves too heavy on binary size or compile time — swap costs a hand-rolled frontmatter strip + syntect wrapper.

# Honest gaps

- No `cargo tree -d` run; comrak-with-syntect is "large" by inspection only.
- markdown-rs frontmatter / GFM completeness verified only via README claims.
- pulldown-cmark GFM autolink completeness not tested against GFM corpus.

# Sources

- comrak: https://github.com/kivikakk/comrak — `Cargo.toml`, `src/lib.rs`, `src/plugins/syntect.rs`, `README.md`, `COPYING`
- markdown-rs: https://github.com/wooorm/markdown-rs — `Cargo.toml`, `src/`, `readme.md`, commits
- pulldown-cmark: https://github.com/pulldown-cmark/pulldown-cmark — `pulldown-cmark/Cargo.toml`, `README.md`, releases
- All metadata via `gh api` 2026-05-21.
