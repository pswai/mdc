import { readFileSync } from 'node:fs';
import { parse, ParseError } from '../parser.js';
import { parseArgs } from '../args.js';
import {
  reportError,
  writeJson,
  writeText,
  itemToJson,
  EXIT,
  type CliContext,
  type ExitCode,
} from '../output.js';

export async function inspectCmd(argv: string[], ctx: CliContext): Promise<ExitCode> {
  const args = parseArgs(argv, new Set());
  if (args.positional.length !== 2) {
    return reportError({ code: 'usage', message: 'mdc inspect <file> <id> [--json]' }, ctx);
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
  const sug = r.suggestions.find((s) => s.id === id);

  if (!ann && !sug) {
    return reportError({ code: 'not-found', message: `no annotation or suggestion with id "${id}"` }, ctx);
  }

  if (ctx.json) {
    const out: { annotation?: unknown; suggestion?: unknown } = {};
    if (ann) out.annotation = itemToJson(ann);
    if (sug) out.suggestion = itemToJson(sug);
    writeJson(out);
    return EXIT.ok;
  }

  if (ann) {
    writeText(`# Annotation ${ann.id} (${ann.status})`);
    writeText(`  Anchor: "${ann.anchor.text}"`);
    writeText(`  Location: line ${ann.anchor.lineRange[0]}, byte ${ann.anchor.byteOffset}`);
    writeText(`  ${ann.comments.length} comment${ann.comments.length === 1 ? '' : 's'}:`);
    for (let i = 0; i < ann.comments.length; i++) {
      const c = ann.comments[i];
      writeText(`    [${i + 1}] ${c.by} @ ${c.time}`);
      const bodyLines = c.body.split('\n');
      for (const line of bodyLines) writeText(`        ${line}`);
    }
  }
  if (sug) {
    if (ann) writeText('');
    writeText(`# Suggestion ${sug.id} (by ${sug.by})`);
    writeText(`  Anchor: "${sug.anchor.text}"`);
    writeText(`  Location: line ${sug.anchor.lineRange[0]}, byte ${sug.anchor.byteOffset}`);
    writeText(`  OLD:`);
    for (const line of sug.old.split('\n')) writeText(`    ${line}`);
    writeText(`  NEW:`);
    for (const line of sug.new.split('\n')) writeText(`    ${line}`);
  }
  return EXIT.ok;
}
