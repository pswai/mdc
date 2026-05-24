import { readFileSync, writeFileSync } from 'node:fs';
import { parse, ParseError } from '../parser.js';
import { parseArgs } from '../args.js';
import { replaceRange, emitAnchor } from '../serializer.js';
import { reportError, writeJson, EXIT, type CliContext, type ExitCode } from '../output.js';

export async function resolveCmd(argv: string[], ctx: CliContext): Promise<ExitCode> {
  const args = parseArgs(argv, new Set());
  if (args.positional.length !== 2) {
    return reportError({ code: 'usage', message: 'mdc resolve <file> <id> [--json]' }, ctx);
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

  const ann = r.annotations.find((a) => a.id === id);
  if (!ann) {
    if (r.suggestions.find((s) => s.id === id)) {
      return reportError({ code: 'not-found', message: `id "${id}" is a suggestion, not an annotation; use mdc accept/reject for suggestions` }, ctx);
    }
    return reportError({ code: 'not-found', message: `no annotation with id "${id}"` }, ctx);
  }
  if (ann.status === 'resolved') {
    if (ctx.json) writeJson({ resolved: id, alreadyResolved: true });
    return EXIT.ok;
  }

  // Find the anchor tag for this annotation and rewrite its status attribute
  const annTag = r.tags.find((t) => t.kind === 'ann' && t.attrs.id === id)!;
  const newAnchorText = emitAnchor(id, 'resolved');
  const final = replaceRange(source, annTag.sourceStart, annTag.sourceEnd, newAnchorText);

  try {
    writeFileSync(file, final, 'utf8');
  } catch (e) {
    return reportError({ code: 'runtime', message: `cannot write ${file}: ${(e as Error).message}` }, ctx);
  }

  if (ctx.json) writeJson({ resolved: id });
  return EXIT.ok;
}
