import type { Annotation, Suggestion, Item } from './types.js';

export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5;

export type ErrorCode = 'runtime' | 'usage' | 'conflict' | 'not-found' | 'invalid-input';

export interface CliContext {
  json: boolean;
  quiet: boolean;
  noColor: boolean;
}

export interface ErrorMatch {
  line: number;
  col: number;
  snippet: string;
  offset: number;
}

export interface MdcError {
  code: ErrorCode;
  message: string;
  at?: { file: string; line: number; col: number };
  context?: Record<string, unknown> & { matches?: ErrorMatch[] };
}

export const EXIT: Record<ErrorCode | 'ok', ExitCode> = {
  ok: 0,
  runtime: 1,
  usage: 2,
  conflict: 3,
  'not-found': 4,
  'invalid-input': 5,
};

export function reportError(err: MdcError, ctx: CliContext): ExitCode {
  if (ctx.json) {
    process.stdout.write(JSON.stringify({ error: err }) + '\n');
  }
  const at = err.at ? ` at ${err.at.file}:${err.at.line}:${err.at.col}` : '';
  process.stderr.write(`mdc: error: ${err.code} — ${err.message}${at ? '\n  ' + at.trim() : ''}\n`);
  if (err.context?.matches) {
    for (let i = 0; i < err.context.matches.length; i++) {
      const m = err.context.matches[i];
      process.stderr.write(`  match ${i + 1} at line ${m.line}:${m.col}   "${m.snippet}"\n`);
    }
    if (err.context.matches.length > 1) {
      process.stderr.write(`  hint: disambiguate with --occurrence N, --line N, or --after/--before "<context>"\n`);
    }
  }
  return EXIT[err.code];
}

export function writeJson(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

export function writeText(s: string): void {
  process.stdout.write(s);
  if (!s.endsWith('\n')) process.stdout.write('\n');
}

export function annotationSummary(a: Annotation): string {
  const replies = a.comments.length;
  const byList = a.comments.map((c) => c.by).join(',');
  const anchor = a.anchor.text.length > 40 ? a.anchor.text.slice(0, 37) + '...' : a.anchor.text;
  return `${a.id}  annotation  ${a.status.padEnd(8)}  by=${byList || '—'}  "${anchor}"  [${replies} reply]`;
}

export function suggestionSummary(s: Suggestion): string {
  const oldText = s.old.length > 30 ? s.old.slice(0, 27) + '...' : s.old;
  const newText = s.new.length > 30 ? s.new.slice(0, 27) + '...' : s.new;
  return `${s.id}  suggestion  by=${s.by}      "${oldText}" → "${newText}"`;
}

export function itemToJson(item: Item): unknown {
  if (item.kind === 'annotation') {
    return {
      kind: 'annotation',
      id: item.id,
      status: item.status,
      anchor: item.anchor,
      comments: item.comments,
    };
  }
  return {
    kind: 'suggestion',
    id: item.id,
    by: item.by,
    anchor: item.anchor,
    old: item.old,
    new: item.new,
  };
}
