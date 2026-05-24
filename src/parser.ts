import type { Annotation, Author, Suggestion } from './types.js';

const TAG_START = '<!--mdc:';
const TAG_END = '-->';

export class ParseError extends Error {
  constructor(
    public file: string,
    public line: number,
    public col: number,
    public reason: string,
  ) {
    super(`parse-error at ${file}:${line}:${col}: ${reason}`);
    this.name = 'ParseError';
  }
}

export interface RawTag {
  kind: 'ann' | 'comment' | 'sug';
  attrs: Record<string, string>;
  /** Body text (between header line and closing `-->`). Newlines preserved. */
  body: string;
  /** Inclusive start byte of `<!--mdc:...`. */
  sourceStart: number;
  /** Exclusive end byte of `-->`. */
  sourceEnd: number;
  line: number;
  col: number;
}

export interface ParseResult {
  source: string;
  /** All raw mdc:* tags in source order. */
  tags: RawTag[];
  annotations: Annotation[];
  suggestions: Suggestion[];
  /** Source with every mdc:* tag stripped (and any single newline that
   *  followed a stripped tag at end-of-line collapsed once). */
  clean: string;
}

export function parse(source: string, filename = '<input>'): ParseResult {
  const tags = scanTags(source, filename);
  const annsById = new Map<string, Annotation>();
  const suggestions: Suggestion[] = [];

  for (const tag of tags) {
    if (tag.kind !== 'ann') continue;
    const id = requireAttr(tag, 'id', filename);
    const status = parseStatus(tag, filename);
    annsById.set(id, {
      kind: 'annotation',
      id,
      status,
      anchor: deriveAnchor(source, tag),
      comments: [],
      sourceRange: [tag.sourceStart, tag.sourceEnd],
    });
  }

  for (const tag of tags) {
    if (tag.kind === 'comment') {
      const annId = requireAttr(tag, 'ann', filename);
      const ann = annsById.get(annId);
      if (!ann) {
        throw new ParseError(filename, tag.line, tag.col, `comment references unknown annotation id "${annId}"`);
      }
      ann.comments.push({
        by: parseAuthor(tag, 'by', filename),
        time: tag.attrs.time ?? '',
        body: tag.body,
      });
      ann.sourceRange[1] = Math.max(ann.sourceRange[1], tag.sourceEnd);
    } else if (tag.kind === 'sug') {
      const id = requireAttr(tag, 'id', filename);
      const { old, new: newText } = parseSuggestionBody(tag, filename);
      suggestions.push({
        kind: 'suggestion',
        id,
        by: parseAuthor(tag, 'by', filename),
        anchor: deriveAnchor(source, tag),
        old,
        new: newText,
        sourceRange: [tag.sourceStart, tag.sourceEnd],
      });
    }
  }

  return {
    source,
    tags,
    annotations: [...annsById.values()],
    suggestions,
    clean: stripTags(source, tags),
  };
}

function scanTags(source: string, filename: string): RawTag[] {
  const tags: RawTag[] = [];
  let i = 0;
  while (i < source.length) {
    const start = source.indexOf(TAG_START, i);
    if (start === -1) break;
    const contentStart = start + TAG_START.length;
    const end = source.indexOf(TAG_END, contentStart);
    if (end === -1) {
      const { line, col } = lineCol(source, start);
      throw new ParseError(filename, line, col, 'unterminated <!--mdc:* tag');
    }
    const inner = source.slice(contentStart, end);
    const fullEnd = end + TAG_END.length;
    const { line, col } = lineCol(source, start);

    const firstNewline = inner.indexOf('\n');
    const headerLine = firstNewline === -1 ? inner : inner.slice(0, firstNewline);
    // Trim leading/trailing newlines from body
    const body = firstNewline === -1 ? '' : inner.slice(firstNewline + 1).replace(/\n+$/, '');

    const headerTrim = headerLine.trim();
    const kindMatch = headerTrim.match(/^(ann|comment|sug)\b\s*(.*)$/);
    if (!kindMatch) {
      throw new ParseError(filename, line, col, `unknown mdc:* tag kind in "${headerTrim.slice(0, 40)}"`);
    }
    const kind = kindMatch[1] as 'ann' | 'comment' | 'sug';
    const attrs = parseAttrs(kindMatch[2], filename, line, col);
    tags.push({ kind, attrs, body, sourceStart: start, sourceEnd: fullEnd, line, col });
    i = fullEnd;
  }
  return tags;
}

function parseAttrs(s: string, filename: string, line: number, col: number): Record<string, string> {
  const attrs: Record<string, string> = {};
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) break;
    const keyStart = i;
    while (i < n && s[i] !== '=' && !/\s/.test(s[i])) i++;
    if (i >= n || s[i] !== '=') {
      throw new ParseError(filename, line, col, `expected = after attribute key at offset ${i}`);
    }
    const key = s.slice(keyStart, i);
    i++; // skip '='
    let value: string;
    if (s[i] === '"') {
      i++;
      const vStart = i;
      while (i < n && s[i] !== '"') i++;
      if (i >= n) {
        throw new ParseError(filename, line, col, `unterminated quoted value for "${key}"`);
      }
      value = s.slice(vStart, i);
      i++;
    } else {
      const vStart = i;
      while (i < n && !/\s/.test(s[i])) i++;
      value = s.slice(vStart, i);
    }
    attrs[key] = value;
  }
  return attrs;
}

function requireAttr(tag: RawTag, name: string, filename: string): string {
  const v = tag.attrs[name];
  if (v === undefined) {
    throw new ParseError(filename, tag.line, tag.col, `missing required attribute "${name}" on mdc:${tag.kind}`);
  }
  return v;
}

function parseStatus(tag: RawTag, filename: string): 'open' | 'resolved' {
  const v = tag.attrs.status ?? 'open';
  if (v !== 'open' && v !== 'resolved') {
    throw new ParseError(filename, tag.line, tag.col, `invalid status "${v}"; expected open|resolved`);
  }
  return v;
}

function parseAuthor(tag: RawTag, attr: string, filename: string): Author {
  const v = tag.attrs[attr] ?? 'human';
  if (v !== 'human' && v !== 'ai') {
    throw new ParseError(filename, tag.line, tag.col, `invalid ${attr} "${v}"; expected human|ai`);
  }
  return v;
}

function parseSuggestionBody(tag: RawTag, filename: string): { old: string; new: string } {
  // Look for lines starting exactly with `old:` and `new:` (no leading whitespace).
  const lines = tag.body.split('\n');
  let oldStart = -1;
  let newStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'old:') oldStart = i;
    else if (lines[i] === 'new:') newStart = i;
  }
  if (oldStart === -1 || newStart === -1 || oldStart > newStart) {
    throw new ParseError(
      filename,
      tag.line,
      tag.col,
      'suggestion body must contain `old:` then `new:` on their own lines',
    );
  }
  const old = lines.slice(oldStart + 1, newStart).join('\n');
  const newText = lines.slice(newStart + 1).join('\n');
  return { old, new: newText };
}

function deriveAnchor(source: string, tag: RawTag): { byteOffset: number; lineRange: [number, number]; text: string } {
  // Walk back from tag start through whitespace, then capture up to 80 chars of preceding text.
  let i = tag.sourceStart;
  while (i > 0 && /\s/.test(source[i - 1])) i--;
  const lookbackStart = Math.max(0, i - 120);
  const before = source.slice(lookbackStart, i);
  // Prefer the last sentence; fall back to the last 60 chars.
  const sentenceMatch = before.match(/([.!?]\s+)?([^.!?\n]{1,80})$/);
  const text = (sentenceMatch ? sentenceMatch[2] : before.slice(-60)).trim();
  return {
    byteOffset: tag.sourceStart,
    lineRange: [tag.line, tag.line],
    text,
  };
}

function stripTags(source: string, tags: RawTag[]): string {
  // Three cases:
  //  1. Tag occupies the whole line (possibly with leading whitespace) → remove tag + trailing \n + leading ws
  //  2. Tag is inline at end of line ("text TAG\n") → remove tag + any trailing whitespace before it
  //  3. Tag is in the middle of a line → strip tag only, leave surrounding text intact
  let out = '';
  let last = 0;
  for (const tag of tags) {
    let start = tag.sourceStart;
    let end = tag.sourceEnd;

    const nextChar = end < source.length ? source[end] : '';
    const trailingNewline = nextChar === '\n';

    let lineStart = start;
    while (lineStart > 0 && (source[lineStart - 1] === ' ' || source[lineStart - 1] === '\t')) lineStart--;
    const atLineStart = lineStart === 0 || source[lineStart - 1] === '\n';

    if (atLineStart && trailingNewline) {
      start = lineStart;
      end += 1;
    } else if (trailingNewline) {
      let ws = start;
      while (ws > 0 && (source[ws - 1] === ' ' || source[ws - 1] === '\t')) ws--;
      start = ws;
    }

    out += source.slice(last, start);
    last = end;
  }
  out += source.slice(last);
  return out;
}

function lineCol(source: string, byteOffset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < byteOffset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

export function collectIds(result: ParseResult): Set<string> {
  const ids = new Set<string>();
  for (const a of result.annotations) ids.add(a.id);
  for (const s of result.suggestions) ids.add(s.id);
  return ids;
}
