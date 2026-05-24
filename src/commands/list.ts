import { readFileSync } from 'node:fs';
import { parse, ParseError, displayableItems } from '../parser.js';
import { parseArgs, stringFlag } from '../args.js';
import {
  reportError,
  writeJson,
  writeText,
  annotationSummary,
  suggestionSummary,
  itemToJson,
  EXIT,
  type CliContext,
  type ExitCode,
} from '../output.js';

export async function listCmd(argv: string[], ctx: CliContext): Promise<ExitCode> {
  const args = parseArgs(argv, new Set([]));
  if (args.positional.length !== 1) {
    return reportError({ code: 'usage', message: 'mdc list <file> [--status open|resolved|all] [--kind annotation|suggestion|all]' }, ctx);
  }
  const file = args.positional[0];
  const status = stringFlag(args, 'status') ?? 'open';
  const kind = stringFlag(args, 'kind') ?? 'all';
  if (!['open', 'resolved', 'all'].includes(status)) {
    return reportError({ code: 'usage', message: `--status must be open|resolved|all; got "${status}"` }, ctx);
  }
  if (!['annotation', 'suggestion', 'all'].includes(kind)) {
    return reportError({ code: 'usage', message: `--kind must be annotation|suggestion|all; got "${kind}"` }, ctx);
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

  const all = displayableItems(r);
  const items = all.filter((item) => {
    if (kind === 'annotation' && item.kind !== 'annotation') return false;
    if (kind === 'suggestion' && item.kind !== 'suggestion') return false;
    if (item.kind === 'annotation') {
      return status === 'all' || item.status === status;
    }
    // suggestions don't have status; treat as open
    return status === 'open' || status === 'all';
  });

  if (ctx.json) {
    writeJson({ items: items.map(itemToJson) });
    return EXIT.ok;
  }
  if (items.length === 0) {
    writeText(`(no items matching status=${status} kind=${kind})`);
    return EXIT.ok;
  }
  for (const item of items) {
    if (item.kind === 'annotation') writeText(annotationSummary(item));
    else writeText(suggestionSummary(item));
  }
  return EXIT.ok;
}
