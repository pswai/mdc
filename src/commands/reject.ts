import { readFileSync, writeFileSync } from 'node:fs';
import { parse, ParseError } from '../parser.js';
import { parseArgs } from '../args.js';
import { removeRange } from '../serializer.js';
import { reportError, writeJson, EXIT, type CliContext, type ExitCode } from '../output.js';

export async function rejectCmd(argv: string[], ctx: CliContext): Promise<ExitCode> {
  const args = parseArgs(argv, new Set());
  if (args.positional.length !== 2) {
    return reportError({ code: 'usage', message: 'mdc reject <file> <id> [--json]' }, ctx);
  }
  const [file, id] = args.positional;

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

  const sug = r.suggestions.find((s) => s.id === id);
  if (!sug) {
    if (r.annotations.find((a) => a.id === id)) {
      return reportError({ code: 'not-found', message: `id "${id}" is an annotation, not a suggestion` }, ctx);
    }
    return reportError({ code: 'not-found', message: `no suggestion with id "${id}"` }, ctx);
  }

  // Remove the suggestion block
  let final = removeRange(source, sug.sourceRange[0], sug.sourceRange[1]);
  if (final[sug.sourceRange[0] - 1] === '\n' && final[sug.sourceRange[0]] === '\n') {
    final = removeRange(final, sug.sourceRange[0], sug.sourceRange[0] + 1);
  }
  // Remove the inline anchor by id (re-parse to find current position)
  const r2 = parse(final, file);
  const ann2 = r2.annotations.find((a) => a.id === id);
  if (ann2) {
    final = removeRange(final, ann2.sourceRange[0], ann2.sourceRange[1]);
    if (final[ann2.sourceRange[0] - 1] === ' ' && (final[ann2.sourceRange[0]] === '\n' || ann2.sourceRange[0] === final.length)) {
      final = removeRange(final, ann2.sourceRange[0] - 1, ann2.sourceRange[0]);
    }
  }

  try {
    writeFileSync(file, final, 'utf8');
  } catch (e) {
    return reportError({ code: 'runtime', message: `cannot write ${file}: ${(e as Error).message}` }, ctx);
  }

  if (ctx.json) writeJson({ rejected: id });
  return EXIT.ok;
}
