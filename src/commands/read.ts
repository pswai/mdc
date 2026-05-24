import { readFileSync } from 'node:fs';
import { parse, ParseError } from '../parser.js';
import { parseArgs, boolFlag, UsageError } from '../args.js';
import { reportError, type CliContext, EXIT, type ExitCode } from '../output.js';

export async function readCmd(argv: string[], ctx: CliContext): Promise<ExitCode> {
  let args;
  try {
    args = parseArgs(argv, new Set(['clean']));
  } catch (e) {
    return reportError(
      { code: 'usage', message: (e as Error).message },
      ctx,
    );
  }
  if (ctx.json) {
    return reportError({ code: 'usage', message: '--json is not supported for `mdc read` in v0' }, ctx);
  }
  if (args.positional.length !== 1) {
    return reportError({ code: 'usage', message: 'mdc read <file> [--clean]' }, ctx);
  }
  const file = args.positional[0];
  const clean = boolFlag(args, 'clean');

  let source: string;
  try {
    source = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  } catch (e) {
    return reportError(
      { code: 'runtime', message: `cannot read ${file}: ${(e as Error).message}` },
      ctx,
    );
  }

  if (!clean) {
    process.stdout.write(source);
    return EXIT.ok;
  }

  try {
    const r = parse(source, file);
    process.stdout.write(r.clean);
    return EXIT.ok;
  } catch (e) {
    if (e instanceof ParseError) {
      return reportError({
        code: 'runtime',
        message: e.reason,
        at: { file: e.file, line: e.line, col: e.col },
      }, ctx);
    }
    throw e;
  }
}

void UsageError;
