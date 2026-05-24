import type { Annotation, CommentMessage, Suggestion } from './types.js';

const FORBIDDEN = '-->';

export class InvalidInputError extends Error {
  constructor(public field: string) {
    super(`invalid-input: "${FORBIDDEN}" is forbidden in ${field}`);
    this.name = 'InvalidInputError';
  }
}

export function emitAnchor(id: string, status: 'open' | 'resolved' = 'open'): string {
  return `<!--mdc:ann id=${id} status=${status}-->`;
}

export function emitComment(annId: string, c: CommentMessage): string {
  if (c.body.includes(FORBIDDEN)) throw new InvalidInputError('comment body');
  return `<!--mdc:comment ann=${annId} by=${c.by} time=${c.time}\n${c.body}\n-->`;
}

export function emitSuggestion(s: Pick<Suggestion, 'id' | 'by' | 'old' | 'new'>): string {
  if (s.old.includes(FORBIDDEN)) throw new InvalidInputError('suggestion old text');
  if (s.new.includes(FORBIDDEN)) throw new InvalidInputError('suggestion new text');
  return `<!--mdc:sug id=${s.id} by=${s.by}\nold:\n${s.old}\nnew:\n${s.new}\n-->`;
}

export function emitAnnotation(ann: Annotation): string {
  const parts = [emitAnchor(ann.id, ann.status)];
  for (const c of ann.comments) parts.push(emitComment(ann.id, c));
  return parts.join('\n');
}

/** Insert text at a byte offset; preserves the rest of source. */
export function insertAt(source: string, offset: number, text: string): string {
  return source.slice(0, offset) + text + source.slice(offset);
}

/** Remove a half-open byte range [start, end). */
export function removeRange(source: string, start: number, end: number): string {
  return source.slice(0, start) + source.slice(end);
}

/** Replace a half-open byte range [start, end) with replacement. */
export function replaceRange(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end);
}
