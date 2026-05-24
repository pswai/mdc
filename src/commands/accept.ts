import { readFileSync, writeFileSync } from 'node:fs';
import { parse, ParseError } from '../parser.js';
import { parseArgs } from '../args.js';
import { replaceRange, removeRange } from '../serializer.js';
import { reportError, writeJson, EXIT, type CliContext, type ExitCode } from '../output.js';

export async function acceptCmd(argv: string[], ctx: CliContext): Promise<ExitCode> {
  const args = parseArgs(argv, new Set());
  if (args.positional.length !== 2) {
    return reportError({ code: 'usage', message: 'mdc accept <file> <id> [--json]' }, ctx);
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
      return reportError({ code: 'not-found', message: `id "${id}" is an annotation, not a suggestion; use mdc resolve to close an annotation` }, ctx);
    }
    return reportError({ code: 'not-found', message: `no suggestion with id "${id}"` }, ctx);
  }

  // Step 1: validate that sug.old still exists in the body
  // The suggestion was anchored inline; look for the inline anchor's position to find where to apply.
  // Strategy: search the source for sug.old before the suggestion's source range.
  const upToSuggestion = source.slice(0, sug.sourceRange[0]);
  const oldIndex = upToSuggestion.lastIndexOf(sug.old);
  if (oldIndex === -1) {
    return reportError({
      code: 'conflict',
      message: 'old text no longer matches the current body; refusing to auto-merge',
      context: {
        expected: sug.old,
        suggestionId: id,
        hint: 'edit the file to restore the old span and re-run mdc accept, or run mdc reject',
      },
    }, ctx);
  }

  // Step 2: replace old with new
  let final = replaceRange(source, oldIndex, oldIndex + sug.old.length, sug.new);
  // Step 3: remove the inline anchor tag and the suggestion block.
  // The suggestion's source range shifted by (new.length - old.length).
  const shift = sug.new.length - sug.old.length;
  // Remove inline anchor: re-parse to find it cleanly.
  const r2 = parse(final, file);
  const ann2 = r2.annotations.find((a) => a.id === id);
  if (ann2) {
    final = removeRange(final, ann2.sourceRange[0], ann2.sourceRange[1]);
    // Clean up dangling whitespace on the now-modified line
    const startCheck = ann2.sourceRange[0];
    if (final[startCheck - 1] === ' ' && (final[startCheck] === '\n' || startCheck === final.length)) {
      final = removeRange(final, startCheck - 1, startCheck);
    }
  }
  // Remove the suggestion block (now possibly shifted)
  const sugStart = sug.sourceRange[0] + shift - (ann2 ? ann2.sourceRange[1] - ann2.sourceRange[0] : 0);
  // Simpler: re-parse and remove the suggestion by id
  const r3 = parse(final, file);
  const sug2 = r3.suggestions.find((s) => s.id === id);
  if (sug2) {
    final = removeRange(final, sug2.sourceRange[0], sug2.sourceRange[1]);
    // Eat a trailing newline if the suggestion was on its own line
    if (final[sug2.sourceRange[0] - 1] === '\n' && final[sug2.sourceRange[0]] === '\n') {
      final = removeRange(final, sug2.sourceRange[0], sug2.sourceRange[0] + 1);
    }
  }
  void sugStart;

  try {
    writeFileSync(file, final, 'utf8');
  } catch (e) {
    return reportError({ code: 'runtime', message: `cannot write ${file}: ${(e as Error).message}` }, ctx);
  }

  if (ctx.json) writeJson({ applied: id });
  return EXIT.ok;
}
