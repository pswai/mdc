import { readFileSync, writeFileSync } from 'node:fs';
import { parse, ParseError, collectIds } from '../parser.js';
import { parseArgs, stringFlag } from '../args.js';
import { findAnchor, extractAnchorOptions, AnchorConflictError, AnchorOffsetMismatchError } from '../anchor.js';
import { emitSuggestion, insertAt, InvalidInputError } from '../serializer.js';
import { generateUniqueId } from '../ids.js';
import { reportError, writeJson, itemToJson, EXIT, type CliContext, type ExitCode, type ErrorMatch } from '../output.js';
import type { Author } from '../types.js';

export async function suggestCmd(argv: string[], ctx: CliContext): Promise<ExitCode> {
  let args;
  try {
    args = parseArgs(argv, new Set());
  } catch (e) {
    return reportError({ code: 'usage', message: (e as Error).message }, ctx);
  }
  if (args.positional.length !== 3) {
    return reportError({
      code: 'usage',
      message: 'mdc suggest <file> "<old-text>" "<new-text>" [--by human|ai] [--line N] [--occurrence N] [--after "<context>"] [--before "<context>"] [--offset N] [--json]',
    }, ctx);
  }
  const [file, oldText, newText] = args.positional;
  const by = (stringFlag(args, 'by') ?? process.env.MDC_AUTHOR ?? 'human') as Author;
  if (by !== 'human' && by !== 'ai') {
    return reportError({ code: 'usage', message: `--by must be human|ai; got "${by}"` }, ctx);
  }
  if (oldText.includes('-->') || newText.includes('-->')) {
    return reportError({ code: 'invalid-input', message: 'suggestion text contains forbidden sequence "-->"' }, ctx);
  }

  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch (e) {
    return reportError({ code: 'runtime', message: `cannot read ${file}: ${(e as Error).message}` }, ctx);
  }

  let r;
  try {
    r = parse(source, file);
  } catch (e) {
    if (e instanceof ParseError) {
      return reportError({ code: 'runtime', message: e.reason, at: { file: e.file, line: e.line, col: e.col } }, ctx);
    }
    throw e;
  }

  let opts;
  try {
    opts = extractAnchorOptions((n) => stringFlag(args, n));
  } catch (e) {
    return reportError({ code: 'usage', message: (e as Error).message }, ctx);
  }

  let anchor;
  try {
    anchor = findAnchor(source, r.tags, oldText, opts, file);
  } catch (e) {
    if (e instanceof AnchorConflictError) {
      const matches: ErrorMatch[] = e.matches.map((m) => ({ line: m.line, col: m.col, snippet: m.snippet, offset: m.start }));
      return reportError({ code: 'conflict', message: e.message, context: { matches } }, ctx);
    }
    if (e instanceof AnchorOffsetMismatchError) {
      return reportError({ code: 'conflict', message: e.message }, ctx);
    }
    throw e;
  }

  const id = generateUniqueId(collectIds(r));
  let suggestionText: string;
  try {
    suggestionText = emitSuggestion({ id, by, old: oldText, new: newText });
  } catch (e) {
    if (e instanceof InvalidInputError) {
      return reportError({ code: 'invalid-input', message: e.message }, ctx);
    }
    throw e;
  }

  // Place suggestion AFTER the line containing the matched old text.
  // The browser UI will render the inline diff at the anchor.start position.
  const lineEnd = source.indexOf('\n', anchor.start);
  const insertOffset = lineEnd === -1 ? source.length : lineEnd;
  // Prefix the suggestion tag with " <!--mdc:ann...-->"-style inline anchor so we know where the old text is.
  // Simpler: put a small anchor inline + suggestion block on its own paragraph below.
  const anchorOffset = anchor.start + oldText.length;
  const nextChar = source[anchorOffset];
  const inline = (nextChar === ' ' || nextChar === '\n' ? '' : ' ') + `<!--mdc:ann id=${id} status=open-->`;
  let final = insertAt(source, anchorOffset, inline);
  const newLineEnd = final.indexOf('\n', insertOffset + inline.length);
  const blockInsertAt = newLineEnd === -1 ? final.length : newLineEnd;
  const blockInsert = (blockInsertAt < final.length && final[blockInsertAt + 1] === '\n' ? '\n' : '\n\n') + suggestionText;
  final = insertAt(final, blockInsertAt, blockInsert);

  try {
    writeFileSync(file, final, 'utf8');
  } catch (e) {
    return reportError({ code: 'runtime', message: `cannot write ${file}: ${(e as Error).message}` }, ctx);
  }

  if (ctx.json) {
    const r2 = parse(final, file);
    const s2 = r2.suggestions.find((s) => s.id === id)!;
    writeJson(itemToJson(s2));
  }
  return EXIT.ok;
}
