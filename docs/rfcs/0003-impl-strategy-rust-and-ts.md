---
RFC: 0003
Title: Implementation strategy — spec-first, two reference impls (Rust + TypeScript)
Status: Accepted
Author: Engineering Manager (Claude) on behalf of MDC
Created: 2026-05-21
Accepted: 2026-05-22
Amends: RFC-0001 §Stack; RFC-0002 §2 (Parser)
---

# Summary

MDC is a format-first project. We ship **two reference implementations of the parser** — Rust (powering the `mdc` CLI binary and `mdc-core` crate) and TypeScript (powering the `@mdc/parser` npm package) — both validated against a **shared fixture corpus**. The format spec is the contract; implementations are subordinate to it.

# Motivation

Supply-chain considerations push us off TypeScript as the sole reference implementation. The npm ecosystem's transitive dependency surface and the Shai-Hulud worm class (legitimate maintainer accounts hijacked to push compromised patch versions) are real threats for a tool that humans and agents will install widely. A Rust binary distributed as a single static artifact has near-zero install-time supply-chain surface.

But "format over app" (Commitment 2) means **JS/TS adoption is non-negotiable**. The ecosystem MDC needs to live in — VS Code extensions, Obsidian plugins, GitHub Apps, browser editors, static-site generators — is JS/TS. A Rust-only reference impl that JS adopters have to FFI into is a friction wall.

The clean answer is neither "Rust only" nor "TS only." It is a spec with two thin reference implementations, each native to its target ecosystem. This is how CommonMark, JSON, and HTML themselves work: a spec is the truth, with reference implementations subordinate.

# Decisions

## 1. The format spec is the contract

The canonical format is defined by:

- `MANIFESTO.md` — vision and commitments
- `docs/rfcs/0001-v0-scope-and-format.md` and `0002-tag-syntax-and-parser.md` — current scope and syntax
- `docs/spec/` — formal grammar and conformance prose (to be created in Phase 1)
- `/fixtures/` — the shared corpus that both implementations must pass identically

Implementations are subordinate to the spec. If an implementation conflicts with the spec, the implementation is wrong. If the spec is wrong, we amend it via RFC and update both implementations.

## 2. The parser is markdown-agnostic

The MDC parser does **not** parse markdown structure. It scans for HTML-comment annotations of the form `<!--mdc:* ...-->`, tracks their byte positions in the source, and exposes them as structured records. The body markdown is opaque to the parser.

This is the key insight that makes two implementations viable: the parser is a few hundred LOC of text scanning + state machine, not a CommonMark implementation. Writing it twice — once in Rust, once in TS — is feasible and small.

A host markdown library is needed only for `mdc serve` (the preview server's render pipeline). That choice lives in the Rust implementation alone; the TS reference does not need or ship a markdown parser.

## 3. Reference implementations

### 3.1 Rust — `mdc-core` crate + `mdc` CLI

- `mdc-core` exposes the parser as a library (`crates/mdc-core/`)
- `mdc` is the CLI binary, distributed via `cargo install`, Homebrew, and a single-file release artifact (`crates/mdc-cli/`)
- The preview server (`mdc serve`) lives here. Host markdown library: **`comrak`** with `default-features = false` to avoid the heavy `onig`/`syntect` chain by default; opt in only to what we need. `pulldown-cmark` is the documented fallback if comrak's footprint still proves too large after stripping. Evidence: [`docs/research/0003-rust-markdown.md`](../research/0003-rust-markdown.md)

### 3.2 TypeScript — `@mdc/parser` npm package

- `@mdc/parser` is the TS-native, dep-minimal parser package
- Adopters in any JS markdown ecosystem (remark, markdown-it, micromark, custom) import `@mdc/parser` and integrate MDC annotations into their tooling
- **Decision: ship `@mdc/parser` only.** Plugin glue (~30 LOC each) lives as documented examples in `docs/examples/`, not as published packages. Promotion from example to published package later is cheap; deprecation is not. Evidence: [`docs/research/0003-js-plugins.md`](../research/0003-js-plugins.md)

## 4. Shared fixture corpus

`/fixtures/` is part of the spec. Initial subdirectories:

- `fixtures/syntax-test/` — render-test artifacts (already exists)
- `fixtures/parser/` — round-trip and idempotence corpus (frontmatter, GFM, nested lists, code blocks, tables, CJK, RTL, emoji, edge cases)
- `fixtures/conformance/` — declarative test cases with expected parse output, run identically by both implementations

Both Rust and TS implementations have CI jobs that fail the build if any fixture round-trip or idempotence test fails. **Drift is caught immediately, not discovered later.**

## 5. Drift policy

A change requiring both implementations updates must:

- Update both in the same PR, **or**
- Update one and open a tracking issue for the other, with a 7-day deadline. CI on the lagging implementation is failing during this window; merges to that area are blocked until the second update lands.

If an implementation falls behind the spec for any reason, the failing CI gates merges from any branch touching the affected area. There is no "we'll catch up later" path.

# Test bar (resolves the user's emphasis on test quality + quantity)

Both implementations must satisfy these test categories. Gating policy: every PR landing parser/CLI/server code must add tests in the relevant category. PRs without tests get rejected at review.

| Category                | Rust tool                | TS tool                   | What it covers                                                                                       |
| ----------------------- | ------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Unit                    | `cargo test`             | `vitest`                  | Per-function correctness                                                                             |
| Property: round-trip    | `proptest`               | `fast-check`              | `serialize(parse(x)) === x` for arbitrary generated markdown                                         |
| Property: idempotence   | `proptest`               | `fast-check`              | After CLI op sequences, second `parse → serialize` cycle is byte-stable (the `comment-md` trap)      |
| Snapshot                | `insta`                  | `vitest` snapshots        | Rendered HTML, error messages, AST dumps                                                             |
| Fixture corpus          | shared `fixtures/`       | same                      | Frontmatter, GFM, math, footnotes, nested lists, code blocks, tables, CJK, emoji, RTL, edge cases    |
| Fuzz                    | `cargo fuzz`             | n/a in v0                 | Parser cannot panic / crash / infinite-loop on adversarial input                                     |
| CLI integration         | `assert_cmd`             | n/a (TS has no CLI in v0) | End-to-end CLI: stdin / stdout / exit codes                                                          |

Coverage targets get gamed; *categories* don't.

# Goals

1. The format spec is independent of any one implementation.
2. Two reference impls exist; both validated against the same corpus.
3. The Rust binary is distributable as a single static artifact with no transitive deps at install time.
4. The TS package has minimal transitive deps — target zero hard runtime deps, one or two acceptable peers.
5. Adopters in either ecosystem get native ergonomics — no WASM cold-start in JS, no FFI complexity in TS.

# Non-goals (explicit)

- **WASM bridge from Rust into JS.** Considered and rejected: maintaining one well-isolated implementation per ecosystem is cleaner than one cross-compiled artifact, given the format is small. WASM cold-start, marshaling overhead, and build pipeline complexity outweigh the "single source of truth" win at MDC's size.
- **Implementations in additional languages** for v0 (Python, Go, Swift, etc.). vNext if adoption demands.
- **A unified plugin API across host parsers.** The remark and markdown-it ecosystems have different idioms; we honor each rather than impose a lowest-common-denominator.

# Distribution

How implementations reach users is a first-class concern, not an afterthought. Dual-impl makes this concrete because both surfaces need a credible install story.

## Rust reference (CLI + crate)

Distribution channels for v0:

- **`cargo install mdc`** — for Rust users. Requires Rust toolchain on the target. Smallest setup for the developer audience but excludes non-Rust users.
- **GitHub Releases** — pre-built static binaries for `x86_64-linux`, `aarch64-linux`, `x86_64-darwin`, `aarch64-darwin`, `x86_64-windows-msvc`. Produced by CI on tag push. Single binary, no runtime deps.
- **`curl <release-url>/install.sh | sh`** — wraps the GitHub Release download. Domain decision deferred; v0 may use the raw GitHub Releases URL.
- **Homebrew tap** — `brew install mdc/tap/mdc` from a project-owned tap; contribution to `homebrew-core` after some traction. **v0 stretch goal**, not blocker.

The `mdc-core` crate is published to `crates.io` for embedding in other Rust projects.

## TypeScript reference (npm)

- **`npm install @mdc/parser`** — published to the npm registry under the `@mdc` scope.
- ESM-first; CJS interop only if cheap. TS types bundled in the package.
- Zero hard runtime dependencies (target). Optional plugin packages (`@mdc/remark`, `@mdc/markdown-it` — see Open Question 2) take their host parser as a `peerDependency` rather than bundling it.
- npm provenance attestation enabled — defense in depth against the worm-class attack that motivated the dual-impl approach in the first place.

## Coordinated versioning

Both implementations publish the **same version number** (e.g., `0.1.0`). A release tag triggers CI for both; the tag is only promoted to published artifacts if both impls pass the shared `/fixtures/` corpus.

- **Major bump** — breaking format changes. RFC required.
- **Minor bump** — additive features, backward-compatible format changes.
- **Patch bump** — bug fixes; no format changes.

Implementations may carry impl-local patch versions (e.g., a Rust-only parser bugfix as `0.1.0+rust.1`) but the format version is the shared digit before any `+` suffix. Any change that requires bumping the shared digit requires both impls to ship synchronously.

## Out of scope for v0

- Container images bundling `mdc`. Adopters install from release binaries in their Dockerfile.
- Plugin registries or discoverability sites.
- `mdc init` and other onboarding tooling — deferred to **RFC-0004** (usage and ergonomics).

# Amendments to prior RFCs

## RFC-0001 §Stack — replaced

The TypeScript-only stack is replaced. Once this RFC is Accepted:

- **Reference CLI:** Rust, Cargo, single static binary distribution
- **Reference npm:** TypeScript, dep-minimal (target zero runtime deps; one or two peers acceptable)
- **Preview server:** Rust (web framework TBD pending [Open Question 3])
- **Test runners:** `cargo test` + `proptest` + `insta` + `cargo fuzz` (Rust); `vitest` + `fast-check` (TS)
- **Formatting:** `rustfmt` (Rust); `prettier`, 2 spaces (TS)
- **Shared:** `/fixtures/` corpus, `MANIFESTO.md`, RFCs

## RFC-0002 §2 (Parser) — amended

The decision "own implementation on `remark` + `unified`" is replaced by "own implementation, dual-language, markdown-agnostic core." The rest of RFC-0002 (HTML-comment syntax, IDs, escape policy, suggestion shape) is unaffected by this RFC.

# Decisions (formerly open questions)

1. **Rust host markdown library**: `comrak` with `default-features = false`. User-accepted 2026-05-22. `pulldown-cmark` is the documented fallback if comrak's footprint proves too large. Evidence: [`docs/research/0003-rust-markdown.md`](../research/0003-rust-markdown.md).
2. **JS plugin packages**: ship `@mdc/parser` only; plugins as ~30-LOC examples in `docs/examples/`. User-accepted 2026-05-22. Evidence: [`docs/research/0003-js-plugins.md`](../research/0003-js-plugins.md).
3. **Test bar** (§Test bar above): accepted as written. User-accepted 2026-05-22.
4. **Rust web framework** for preview server — `axum`, `actix-web`, or `tide`. Deferred until v0 reaches preview-server work.

# Definition of done

- [x] `docs/research/0003-rust-markdown.md` returned: `comrak` recommended (user-accepted 2026-05-22)
- [x] `docs/research/0003-js-plugins.md` returned: ship `@mdc/parser` only (user-accepted 2026-05-22)
- [x] Test bar accepted (user-accepted 2026-05-22)
- [x] RFC-0001 §Stack amendment applied
- [x] RFC-0002 §2 amendment applied

All gating items resolved. Status moved to Accepted 2026-05-22.

# References

- Manifesto: [`../../MANIFESTO.md`](../../MANIFESTO.md)
- RFC-0001: [`./0001-v0-scope-and-format.md`](./0001-v0-scope-and-format.md)
- RFC-0002: [`./0002-tag-syntax-and-parser.md`](./0002-tag-syntax-and-parser.md)
- Pending research: [`../research/0003-rust-markdown.md`](../research/0003-rust-markdown.md), [`../research/0003-js-plugins.md`](../research/0003-js-plugins.md)
