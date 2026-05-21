# MDC — Markdown-Native Human-AI Document Collaboration

## Vision

Markdown is the lingua franca of human-AI collaboration on text. It is what LLMs already emit and what humans read raw. But as a _collaboration surface_, markdown is impoverished compared to what humans built for human-human collaboration twenty years ago: no inline comments anchored to spans, no suggestion mode with accept/reject, no threaded discussion, no span-level addressing both sides can point at, no provenance.

The current state of practice — pasting whole files back to the LLM, quoting in chat, describing locations in prose — is a regression from 2006 Google Docs.

Cursor solved this for **code**. The equivalent for **prose** is fractured across dozens of partial solutions and not yet won. MDC closes the gap. We define the primitive — a portable format and a small CLI — so any `.md` file can carry inline comments, suggestions, and threaded discussion that humans and AI agents read and write through the same surface.

## The Five Commitments

### 1. The file is the source of truth.

Comments and suggestions live inside the `.md`. No sidecar JSON. No SQLite. No server. The artifact round-trips through `git diff` and survives the death of any tool we build. Anyone with a text editor — today or in ten years — can read and edit it.

### 2. Format over app.

We are not building a product. We are defining a primitive that other tools — editors, IDEs, agents — can adopt. The CLI is the reference implementation, not the destination. Success is measured by **adoption of the format**, not seats on our tool.

### 3. Agents are peers, not features.

The AI is not a sidebar that edits the document; it is a participant that comments, suggests, replies, and resolves through the same interface a human uses. The CLI is harness-agnostic — Claude Code, Cursor, Aider, anything that can shell out can be a peer. We do not couple to any one harness, even when it would be convenient.

### 4. Local-first, single writer.

Files on disk. One human, their agents, no server, no auth, no cloud. Real-time multi-user collaboration is a different problem we will not contaminate v0 trying to solve. Deferring is not weakness; it is scope discipline.

### 5. Delete more than we add.

Every change is measured against one test: _does this make delivery more reliable, more honest, or more portable?_ If not, it does not ship. We refuse the polished GUI, the bundled LLM integration, the MCP server, the multi-user CRDT — not because they are bad, but because they are not v0. We are a small, sharp tool, not a platform.

---

This is the contract. Anything that contradicts these commitments either loses, or requires updating this document explicitly and first.
