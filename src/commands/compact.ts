import { readFileSync, writeFileSync } from 'node:fs';
import { parse, ParseError } from '../parser.js';
import { parseArgs } from '../args.js';
import { removeRange } from '../serializer.js';
import { reportError, writeJson, EXIT, type CliContext, type ExitCode } from '../output.js';

export async function compactCmd(argv: string[], ctx: CliContext): Promise<ExitCode> {
  const args = parseArgs(argv, new Set());
  if (args.positional.length !== 1) {
    return reportError({ code: 'usage', message: 'mdc compact <file> [--json]' }, ctx);
  }
  const [file] = args.positional;

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

  const removedIds: string[] = [];
  // Collect ranges to remove: anchor + all its comments
  const toRemove: Array<[number, number]> = [];
  for (const ann of r.annotations) {
    if (ann.status !== 'resolved') continue;
    removedIds.push(ann.id);
    // Range covers anchor + comments (we tracked the full extent in sourceRange)
    toRemove.push([ann.sourceRange[0], ann.sourceRange[1]]);
    // Also include any other comment tags that reference this annotation (in case some are outside the tracked range)
    for (const tag of r.tags) {
      if (tag.kind === 'comment' && tag.attrs.ann === ann.id) {
        if (tag.sourceStart < ann.sourceRange[0] || tag.sourceEnd > ann.sourceRange[1]) {
          toRemove.push([tag.sourceStart, tag.sourceEnd]);
        }
      }
    }
  }
  // Sort descending so removals don't shift earlier offsets
  toRemove.sort((a, b) => b[0] - a[0]);
  let final = source;
  for (const [start, end] of toRemove) {
    let s = start;
    let e = end;
    const prevChar = s > 0 ? final[s - 1] : '\n';
    const nextChar = e < final.length ? final[e] : '';
    if ((prevChar === '\n' || s === 0) && nextChar === '\n') {
      e += 1;
    } else if (nextChar === '\n') {
      let ws = s;
      while (ws > 0 && (final[ws - 1] === ' ' || final[ws - 1] === '\t')) ws--;
      s = ws;
    }
    final = removeRange(final, s, e);
  }

  try {
    writeFileSync(file, final, 'utf8');
  } catch (e) {
    return reportError({ code: 'runtime', message: `cannot write ${file}: ${(e as Error).message}` }, ctx);
  }

  if (ctx.json) writeJson({ removed: removedIds });
  return EXIT.ok;
}
