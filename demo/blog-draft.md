# Why Markdown Is the Wrong Default for AI-Assisted Writing

Markdown won the war for documentation, READMEs, and notes. Every LLM emits it; every developer reads it raw. It's the lingua franca of text on the modern internet.

But as a medium for human-AI *collaboration* on prose, markdown is the wrong default. It's a serialization format that we've been pretending is a collaboration surface.

## Three things markdown doesn't do

When a human and an AI work together on the same document, they need to:

- Point at a span and say "this part"
- Propose an edit the other can accept or reject
- Reply to each other in a thread anchored to the span

Word Track Changes did this in 1995. Google Docs did it in 2006. Cursor did it for code in 2023. Markdown still has none of it.

Today's workaround is to paste the entire document back to the AI and quote chunks in chat. That is a regression from 2006 Google Docs.

## What it would take

Three things, in order of importance:

1. A format that carries inline comments, suggestions, and threads inside the markdown file itself — no sidecar database
2. A surface where the human can read the annotated document with the same delight as Google Docs
3. A CLI any agent can drive, so the AI is a peer in the conversation rather than a sidebar feature

The format has to come first, because it's the part that survives every tool we build on top of it.
