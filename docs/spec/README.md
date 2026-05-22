# MDC Format Specification

This directory holds the canonical MDC format specification — formal grammar, conformance prose, and edge-case definitions that both reference implementations must satisfy.

## Status

**Placeholder.** Content lands in Phase 1, alongside the parser implementations.

Until then, the format is defined operationally by:

- [`MANIFESTO.md`](../../MANIFESTO.md) — vision and the five commitments
- [`docs/rfcs/0001-v0-scope-and-format.md`](../rfcs/0001-v0-scope-and-format.md) — v0 scope, CLI surface, DoD
- [`docs/rfcs/0002-tag-syntax-and-parser.md`](../rfcs/0002-tag-syntax-and-parser.md) — HTML-comment tag syntax, IDs, escape policy, suggestion shape
- [`docs/rfcs/0003-impl-strategy-rust-and-ts.md`](../rfcs/0003-impl-strategy-rust-and-ts.md) — spec-first principle, dual reference impls, test bar
- [`/fixtures/`](../../fixtures/) — the shared corpus both reference implementations must pass identically

Once the parser is implemented, formal grammar and conformance prose move here. The RFCs above plus the fixture corpus remain authoritative until that work lands.
