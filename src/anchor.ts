import type { RawTag } from './parser.js';
import { lineCol, snippetAround } from './utils.js';

export interface AnchorOptions {
  line?: number;
  occurrence?: number;
  after?: string;
  before?: string;
  offset?: number;
}

export interface AnchorMatch {
  /** Byte offset of the match's first char in source. */
  start: number;
  line: number;
  col: number;
  snippet: string;
}

export class AnchorConflictError extends Error {
  constructor(
    public matches: AnchorMatch[],
    public quotedText: string,
    public filename: string,
  ) {
    super(
      matches.length === 0
        ? `"${truncate(quotedText)}" not found in ${filename}`
        : `"${truncate(quotedText)}" appears ${matches.length} times in ${filename}`,
    );
    this.name = 'AnchorConflictError';
  }
}

export class AnchorOffsetMismatchError extends Error {
  constructor(
    public quotedText: string,
    public offset: number,
    public found: string,
    public filename: string,
  ) {
    super(`--offset ${offset} validation failed in ${filename}: expected "${truncate(quotedText)}", found "${truncate(found)}"`);
    this.name = 'AnchorOffsetMismatchError';
  }
}

function truncate(s: string, max = 40): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Find the unique anchor in `source` for `quotedText`, honoring disambiguation flags.
 * Skips occurrences that overlap any existing mdc:* tag range.
 */
export function findAnchor(
  source: string,
  tags: RawTag[],
  quotedText: string,
  opts: AnchorOptions,
  filename: string,
): AnchorMatch {
  const tagRanges = tags.map((t): [number, number] => [t.sourceStart, t.sourceEnd]);

  const insideTag = (offset: number, length: number): boolean => {
    for (const [s, e] of tagRanges) {
      if (!(offset + length <= s || offset >= e)) return true;
    }
    return false;
  };

  // --offset path: validate, don't search
  if (opts.offset !== undefined) {
    const found = source.slice(opts.offset, opts.offset + quotedText.length);
    if (insideTag(opts.offset, quotedText.length) || found !== quotedText) {
      throw new AnchorOffsetMismatchError(quotedText, opts.offset, found, filename);
    }
    const { line, col } = lineCol(source, opts.offset);
    return { start: opts.offset, line, col, snippet: snippetAround(source, opts.offset) };
  }

  // Collect all body matches
  const matches: AnchorMatch[] = [];
  let i = 0;
  while (i < source.length) {
    const found = source.indexOf(quotedText, i);
    if (found === -1) break;
    if (!insideTag(found, quotedText.length)) {
      const { line, col } = lineCol(source, found);
      matches.push({ start: found, line, col, snippet: snippetAround(source, found) });
    }
    i = found + 1;
  }

  // Apply filters in order
  let filtered = matches;
  if (opts.line !== undefined) {
    filtered = filtered.filter((m) => m.line === opts.line);
  }
  if (opts.after !== undefined) {
    const afterIdx = source.indexOf(opts.after);
    if (afterIdx === -1) {
      throw new AnchorConflictError([], `${quotedText} (after: ${opts.after})`, filename);
    }
    filtered = filtered.filter((m) => m.start > afterIdx);
  }
  if (opts.before !== undefined) {
    const beforeIdx = source.lastIndexOf(opts.before);
    if (beforeIdx === -1) {
      throw new AnchorConflictError([], `${quotedText} (before: ${opts.before})`, filename);
    }
    filtered = filtered.filter((m) => m.start + quotedText.length <= beforeIdx);
  }
  if (opts.occurrence !== undefined) {
    if (opts.occurrence > 0 && opts.occurrence <= filtered.length) {
      return filtered[opts.occurrence - 1];
    }
    throw new AnchorConflictError(filtered, quotedText, filename);
  }

  if (filtered.length === 1) return filtered[0];
  throw new AnchorConflictError(filtered, quotedText, filename);
}

export function extractAnchorOptions(get: (name: string) => string | undefined): AnchorOptions {
  const opts: AnchorOptions = {};
  const line = get('line');
  if (line !== undefined) {
    const n = Number(line);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--line must be a positive integer; got "${line}"`);
    opts.line = n;
  }
  const occ = get('occurrence');
  if (occ !== undefined) {
    const n = Number(occ);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--occurrence must be a positive integer; got "${occ}"`);
    opts.occurrence = n;
  }
  const offset = get('offset');
  if (offset !== undefined) {
    const n = Number(offset);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--offset must be a non-negative integer; got "${offset}"`);
    opts.offset = n;
  }
  const after = get('after');
  if (after !== undefined) opts.after = after;
  const before = get('before');
  if (before !== undefined) opts.before = before;
  return opts;
}
