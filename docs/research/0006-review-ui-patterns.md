# Research 0006 — Review UI Patterns for `mdc serve`

Background for RFC-0006. `[doc]` = confirmed from linked source; `[conv]` = convention from prior use, not pinned this pass.

## Patterns extracted

### GitHub PR review

- **Placement**: blue `+` icon on row hover; editor docks _under_ the line, in-flow [doc — [commenting](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request)].
- **Suggestion vs comment**: fenced ` ```suggestion ` block _inside_ a normal comment; renders as red/green diff with "Commit suggestion" [doc — [incorporating feedback](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request)]. Distinct affordance, not distinct widget.
- **Replies**: inline list under the anchor + "Reply…" composer [conv].
- **Accept/reject**: "Commit suggestion" (apply) or "Add suggestion to batch" (defer); reject is implicit via "Resolve conversation" [doc].
- **Batched review**: "Start a review" → "Submit review" prevents notification storms [doc].
- **Outdated marker**: collapsed thread + grey "Outdated" pill when the anchor moved [doc, mentioned].
- **Right-rail**: Conversations menu marks files with comments [doc, partial].

### Google Docs comments + Suggesting

- **Comment**: highlight on span; bubble in right margin; click → side-rail thread [doc — [Docs comments](https://support.google.com/docs/answer/65129)].
- **Suggesting**: inline strikethrough + colored insert with Accept/Reject pinned to the change; "Review suggested edits" panel for bulk [doc — [Suggesting](https://support.google.com/docs/answer/6033474)].
- **Keyboard**: `J/K` next/prev, `R` reply, `E` resolve, `U` exit [doc]. Strong vim-ish precedent.
- **Resolved**: hidden from rail by default, retrievable [doc].

### Ink & Switch tiny-essay-editor

- README confirms CodeMirror + automerge-codemirror with "inline comments + replies" but no UI prose [doc — [repo](https://github.com/inkandswitch/tiny-essay-editor)]. Ink & Switch Patchwork/Peritext essays show **highlighted span + thread bubble in right margin aligned to anchor** [conv, from Patchwork screenshots]. Load-bearing idea: threads track the scroll position of their anchor.

### VSCode GitHub PR extension

- Diamond gutter icon on commented lines; click opens a docked panel under the line in a native diff editor [doc — [VSCode docs](https://code.visualstudio.com/docs/sourcecontrol/github)]. Gutter marker = cheap signal; heavy UI is on demand.

### Word Track Changes vs Docs Suggesting (keyboard)

- Word: `Ctrl+Shift+E` toggles tracking; accept/reject lives on the ribbon, no default shortcut [doc — [Word shortcuts](https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-word-95ef89dd-7142-4b50-afb2-f762f663ceb2)]. Docs wins: `J/K` + inline buttons.

### Accessibility primitives

- WAI-ARIA 1.3 ships `role="comment"` and `role="suggestion"` for exactly this [doc — [ARIA 1.3](https://w3c.github.io/aria/#comment)]. Use them.
- SSE-delivered annotations: `aria-live="polite"` one-liner ("New comment from agent on 'lazy dog'"); never `assertive` [doc — [MDN aria-live](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live)].

---

## Recommendation for MDC v0

| Decision | Pick | Manifesto justification |
| --- | --- | --- |
| **Anchor placement** | Inline highlight on the span + right-margin bubble aligned to the anchor (Docs / tiny-essay-editor). | File is truth — UI maps 1:1 to a `mdc:ann` tag on that span; no synthetic line numbers. |
| **Thread pattern** | Margin bubble expands to a docked side-rail thread (Docs). No floating popovers — they hide on scroll, break keyboard nav. | Agents are peers: one canonical thread view, not a hover-only surface. |
| **Suggestion display** | Inline strikethrough + colored insert with Accept/Reject pinned to the change (Docs); reuse the comment rail. | Delete more than we add — no second widget. |
| **Live-update cue** | On SSE change: fade-in the new annotation, briefly outline its anchor, emit one `aria-live="polite"` summary. No reload, no jump. | File is truth — show the disk change without taking the reader's place. |

**Keyboard floor**: `J/K` next/prev, `R` reply, `A` accept, `X` reject, `E` resolve. Borrowed from Docs — muscle memory is already there.
