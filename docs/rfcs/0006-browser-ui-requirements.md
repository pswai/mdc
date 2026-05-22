---
RFC: 0006
Title: Browser UI requirements for `mdc serve`
Status: Draft
Author: Engineering Manager (Claude) on behalf of MDC
Created: 2026-05-22
Depends-on: RFC-0001 (preview server capability), RFC-0002 (format), RFC-0003 (impl strategy), RFC-0005 (CLI surface)
---

# Summary

Locks the interaction model, layout, keyboard shortcuts, accessibility floor, and error/conflict UX for the browser UI that `mdc serve` boots. Not a visual design doc — colors, type, spacing are deferred. This RFC defines the *requirements* and *behavior contract*; the Phase 1 preview-server PR (Task 6) translates them into HTML/CSS/JS.

Patterns picked are anchored in `docs/research/0006-review-ui-patterns.md` (Google Docs, GitHub PR, Ink & Switch tiny-essay-editor / Patchwork, ARIA 1.3). Each pick is justified against a manifesto commitment.

# Audience and modes

The browser UI is for **the human**, in **read + react** mode. Editing the document body itself stays in the human's editor of choice (VSCode, Obsidian, vim, etc.). The file on disk is the source of truth (Commitment 1); everything the UI does writes back to the `.md` through the same CLI surface (Commitment 3 — agents are peers).

What the UI is for, in order of weight:

1. **Read the rendered document** with annotations visualized in context
2. **React to suggestions** (accept / reject in one click)
3. **Discuss in threads** (reply to comments, resolve)
4. **Author new annotations** (select span → comment / suggest)

What the UI is *not* for:

- Editing the document body (use your editor)
- Chat with the AI (the AI lives in your harness)
- Browsing many files (single-file scope in v0; see RFC-0001 non-goals)

# Layout

Three regions on a single page. ASCII reference (not to scale):

```
┌────────────────────────────────────────────────┬─────────────────┐
│ TOP BAR: filename · status · connection dot     │                 │
├────────────────────────────────────────────────┼─────────────────┤
│                                                │                 │
│   Rendered markdown                            │  Right margin   │
│                                                │                 │
│   The quick brown [fox]·· jumps over the      ●│  (bubbles       │
│   [lazy dog]··.                                ●│   per           │
│                                                │   annotation,   │
│   The [fox ran away.]══════════════           ●│   aligned to    │
│   "The fox darted into the brush."             │   anchor)       │
│                                                │                 │
│                                                │                 │
└────────────────────────────────────────────────┴─────────────────┘
```

- **Main column** (~60–75% width): rendered markdown via `comrak`. Anchored spans get inline visual treatment (see §Anchor placement). No editing affordance.
- **Right margin** (~20–30% width): one bubble per open annotation, anchored to the y-position of its span. Bubbles stay aligned to their anchor as the user scrolls. Click a bubble to expand it into a thread view (replaces the bubble in place, pushes its neighbors).
- **Top bar**: filename, save-state indicator ("up to date" / "writing…" / "error"), SSE connection dot (green / amber / red).

Resolved annotations are hidden by default. A "Show resolved (N)" toggle in the top bar reveals them with a `resolved` visual treatment.

# Anchor placement

**Pick (matches Google Docs + Patchwork):** inline highlight on the anchored span + right-margin bubble aligned to the anchor.

| Manifesto justification |
| --- |
| File is truth (Commitment 1). The UI maps 1:1 to a `mdc:ann` tag in the source; no synthetic line numbers, no parallel state. |

- **Inline highlight**: subtle background color on the annotated span. Open = pale yellow; resolved = pale grey; conflict = pale red (see §Error / conflict).
- **Margin bubble**: a small circle with the annotation's `by` initial (H / A) and the thread depth (number of replies, including the seed). Aligned vertically to the anchor center.
- **Hover**: anchor span and its bubble both highlight slightly (cross-link affordance).
- **Click anchor → opens thread**; click bubble → opens thread. Same action.

**Rejected alternatives:**

- *Gutter marker only* (VSCode PR extension style) — too cheap a signal; in prose-heavy docs the gutter is too far from the anchor. We borrow VSCode's "cheap signal + heavy UI on demand" *philosophy*, not its placement.
- *Floating popover on hover only* — hides on scroll, breaks keyboard navigation. Threads are a first-class surface, not a hover detail (Commitment 3 — agents are peers, not annotations).

# Suggestion display

**Pick (matches Google Docs Suggesting):** inline strikethrough on `old`, inline colored insert of `new`, with Accept / Reject pinned to the change in place. Suggestions live in the same right-margin column as comments — no separate widget — but they get a distinct visual treatment.

```
The [fox ran away.]══════════════ ▶ "The fox darted into the brush."   [Accept] [Reject]
    ^---strikethrough---^         ^----colored insert----^
```

| Manifesto justification |
| --- |
| Delete more than we add (Commitment 5). No second widget for suggestions — they're a *kind* of annotation in the same surface, distinguished by visual treatment. |

- The `old` text in the body gets a strikethrough overlay
- The `new` text appears inline, in a colored "proposed" treatment, immediately after the strike
- Accept / Reject buttons pin to the suggestion. After click, the inline change applies (Accept) or reverts (Reject) and the suggestion's margin bubble disappears
- On Accept conflict (the `old` no longer matches the body — see RFC-0001 Decision 3): the suggestion's visual treatment switches to the **conflict** color (pale red) and the bubble shows a "Conflict — review" affordance. See §Error / conflict.

**Rejected alternatives:**

- *GitHub's ` ```suggestion ` block inside a comment* — we have `old` and `new` already in RFC-0002 §5, no need to host a fenced diff editor. Same idea ("distinct affordance, not distinct widget"), better fit.

# Thread interaction

When a margin bubble is clicked, it expands in place to a docked side-rail thread:

```
┌──────────────────────────┐
│ H Human · 10 min ago     │
│ Is "lazy" the right word? │
├──────────────────────────┤
│ A AI · 9 min ago         │
│ "Sleeping" if literal,    │
│ "indolent" if behavioral. │
├──────────────────────────┤
│ [Reply...]               │
├──────────────────────────┤
│ [Resolve thread]         │
└──────────────────────────┘
```

- **Reply composer** is always at the bottom of the open thread
- **Resolve** sets the annotation status to `resolved` per RFC-0001 Decision 4; the thread collapses; "Show resolved" reveals it again
- Closing the thread (clicking the body, pressing `Esc`) collapses back to a margin bubble
- Floating popovers are explicitly **not** used — threads are anchored to their bubble, scroll with the document, and stay keyboard-reachable

# Authoring affordances

Selecting body text reveals a small floating button: "Comment" + "Suggest". (One UI element with two actions, not two separate buttons.)

- **Comment**: opens a composer pinned to the selection. On submit, writes via local server → `mdc comment <file> "<selected text>" "<body>"` (RFC-0005)
- **Suggest**: opens a two-field composer (old = selection, new = blank). On submit, writes via local server → `mdc suggest <file> "<selected>" "<new>"`

The floating button disappears on click-outside or selection-clear.

# Live-update behavior

The server watches the file (the human's editor saves, or an agent runs an `mdc` command — both paths write to disk) and emits SSE events on change. Event types:

| Event                  | Trigger                            | UI response                                                                          |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| `annotation-added`     | new `mdc:ann` tag detected         | fade-in margin bubble; briefly outline anchor (1s pulse); `aria-live` announcement   |
| `annotation-updated`   | comment added / status changed     | update bubble badge (reply count, status color); no scroll jump                      |
| `annotation-removed`   | `mdc compact` or manual edit       | fade out the bubble; if its thread is open, close it gracefully with a notice        |
| `suggestion-added`     | new `mdc:sug` tag                  | inline `old`/`new` overlay + Accept/Reject buttons appear                            |
| `body-changed`         | markdown body changed              | re-render body; preserve scroll position; preserve cursor/focus                      |
| `parse-error`          | file is no longer parseable        | top bar turns amber; banner: "file has malformed MDC tags; fix in your editor"        |

**Never reload the page.** Scroll position, focus, and the open-thread state must survive any event. If a partial update would corrupt UI state, the implementation may schedule a full DOM diff, but the user must not see a flash or jump.

| Manifesto justification |
| --- |
| File is truth. The reader's place in the document must survive disk changes; the UI is the second source, not the primary one. |

# Keyboard shortcuts

The keyboard floor is borrowed from Google Docs to inherit muscle memory:

| Key       | Action                                          |
| --------- | ----------------------------------------------- |
| `j`       | Next annotation (scroll into view, focus bubble) |
| `k`       | Previous annotation                              |
| `r`       | Reply to current thread (focuses composer)      |
| `a`       | Accept current suggestion                       |
| `x`       | Reject current suggestion                       |
| `e`       | Resolve current thread                          |
| `Enter`   | Open / submit the focused thread                |
| `Esc`     | Close open thread; clear selection              |
| `?`       | Show keyboard help                              |

**No vim modes**, no chord shortcuts, no Ctrl/Cmd-required shortcuts in v0. Each shortcut is one keypress. Conflict with browser shortcuts (`Cmd+R` reload, etc.) is avoided by sticking to single letters that don't collide.

# Accessibility floor

Non-negotiable, gated in CI via `axe-core` on the rendered HTML.

- **ARIA 1.3 roles**: `role="comment"` on each thread message; `role="suggestion"` on suggestion overlays. Use these because they exist for exactly this purpose ([ARIA 1.3 §3.2.3](https://w3c.github.io/aria/#comment)).
- **Focus management**: every interactive element reachable via Tab. Focus visible at all times (no `outline: none`). Opening a thread moves focus into it; closing returns focus to the bubble.
- **Live announcements**: SSE-delivered annotations announce via a single `aria-live="polite"` region — one summary per event (`"New comment from agent on 'lazy dog'"`). **Never `assertive`** (interrupts the reader; violates the "stay out of the way" principle).
- **Color is not the only signal**: status (open / resolved / conflict) is also conveyed via icon shape or label, not only color. Important for color-blind users and for printing.
- **Keyboard parity**: every action above is doable without a mouse.
- **Reduced motion**: `prefers-reduced-motion: reduce` disables the fade-in and the anchor-pulse animation; the bubble simply appears.

# Theme

`prefers-color-scheme: dark` auto-applies a dark theme. No manual toggle in v0. Both themes ship with the same CSS variables; styling is variables-only so theme switching doesn't require JavaScript.

# Error / conflict UX

| Condition                       | UI response                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Suggestion accept conflict      | Bubble + inline span turn pale red. Click reveals a unified diff (`expected` vs `found`) with a "Reject" and "Resolve manually" button.    |
| Parse error in file             | Amber top bar + banner ("This file has malformed MDC tags. Fix in your editor; the preview will update."). Body still renders best-effort. |
| Lost connection to local server | Red SSE indicator + toast ("Lost connection to mdc serve. Refresh when ready."). No auto-reconnect storms — exponential backoff, max 30s.  |
| Server returns error on write   | Inline toast on the action that failed (e.g., "Reply failed: invalid-input — `-->` in body"). The composer keeps the user's input.         |

# Performance floor

| Target                                | Bound                                                       |
| ------------------------------------- | ----------------------------------------------------------- |
| Cold start (request → first render)   | < 500 ms for files ≤ 100 KB                                  |
| SSE update → visual update             | < 100 ms                                                    |
| File size soft limit                  | Renders cleanly to 1 MB; above that, show "Document too large; switch to source" with a `mdc read` hint |
| Annotation count                      | Renders cleanly to 500 annotations per file                  |

These are the v0 floors. Above 1 MB / 500 annotations: degrade gracefully, never crash.

# Server endpoints (browser → local server)

The browser UI does not call the CLI directly; it talks to a small REST surface on the local server, which calls into `mdc-core` (RFC-0003) as a library:

| Endpoint                | Maps to (per RFC-0005)                          |
| ----------------------- | ----------------------------------------------- |
| `GET  /api/state`       | full document + parsed annotations              |
| `GET  /api/events`      | SSE stream of changes                           |
| `POST /api/comment`     | `mdc comment` (or `--reply-to`)                 |
| `POST /api/suggest`     | `mdc suggest`                                   |
| `POST /api/accept`      | `mdc accept`                                    |
| `POST /api/reject`      | `mdc reject`                                    |
| `POST /api/resolve`     | `mdc resolve`                                   |

Endpoints are bound to `127.0.0.1` only (RFC-0005 `mdc serve` security default). No authentication. All requests return the RFC-0005 error envelope shape on failure.

# Non-goals (v0)

- Multi-file navigation; a file picker; project-level view
- Search across annotations
- Filter sidebar (filter by status / kind / author)
- Mobile-responsive layout (cf. screen too narrow → "minimum width 720px" message)
- Print stylesheet
- Manual dark-mode toggle (auto only via `prefers-color-scheme`)
- Custom user themes / CSS overrides
- Authoring via the browser when no editor is open (we expect the user to have an editor; the UI is read + react)
- Multi-cursor / collaborative cursors / presence indicators
- Webhooks / external notifications

# Definition of done

This RFC moves to `Accepted` when:

- [ ] Every interaction (anchor, thread, suggestion, authoring, keyboard, live-update, error) has a defined behavior and a manifesto-tied justification
- [ ] Server endpoints map cleanly to RFC-0005 CLI commands
- [ ] Accessibility floor is concrete (ARIA roles, focus model, live region, color-not-only-signal, keyboard parity, reduced-motion) and gated in CI plan
- [ ] Performance floors are numeric, not adjectival
- [ ] Independent reviewer subagent passes the RFC
- [ ] User accepts

# References

- RFC-0001 §Preview server (capability)
- RFC-0002 (HTML-comment syntax that the UI visualizes)
- RFC-0003 (impl strategy; the server is in Rust, talks to `mdc-core` directly)
- RFC-0005 (CLI surface; server endpoints map 1:1)
- Research: [`docs/research/0006-review-ui-patterns.md`](../research/0006-review-ui-patterns.md)
- WAI-ARIA 1.3: https://w3c.github.io/aria/
