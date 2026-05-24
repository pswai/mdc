import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readCmd } from './commands/read.js';
import { listCmd } from './commands/list.js';
import { commentCmd } from './commands/comment.js';
import { suggestCmd } from './commands/suggest.js';
import { acceptCmd } from './commands/accept.js';
import { rejectCmd } from './commands/reject.js';
import { resolveCmd } from './commands/resolve.js';
import { compactCmd } from './commands/compact.js';
import type { CliContext, ExitCode } from './output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HELP = `mdc — markdown-native human-AI document collaboration

Usage: mdc <command> [args] [flags]

Commands:
  read     <file> [--clean]                   Print file (with --clean: strip mdc tags)
  list     <file> [--status S] [--kind K]     List annotations and suggestions
  comment  <file> "<text>" "<body>" [...]     Anchor a comment
  suggest  <file> "<old>" "<new>" [...]       Anchor a suggestion
  accept   <file> <id>                        Apply a suggestion
  reject   <file> <id>                        Discard a suggestion
  resolve  <file> <id>                        Mark an annotation resolved
  compact  <file>                             Strip resolved annotations
  serve    <file> [--port N] [--no-open]      Launch local preview server

Global flags:
  --help, -h       Show this help
  --version, -V    Print version
  --json           Machine-readable output
  --quiet, -q      Suppress non-error output
  --no-color       Disable ANSI color

Run 'mdc <command> --help' for per-command details. (v0 stub: full help on
each command is the synopsis line printed on usage error.)
`;

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function extractGlobalFlags(argv: string[]): { ctx: CliContext; rest: string[] } {
  let json = false;
  let quiet = false;
  let noColor = false;
  const rest: string[] = [];
  for (const a of argv) {
    if (a === '--json') json = true;
    else if (a === '--quiet' || a === '-q') quiet = true;
    else if (a === '--no-color') noColor = true;
    else rest.push(a);
  }
  return { ctx: { json, quiet, noColor }, rest };
}

export async function main(rawArgv = process.argv.slice(2)): Promise<ExitCode> {
  if (rawArgv.length === 0 || rawArgv[0] === '--help' || rawArgv[0] === '-h') {
    process.stdout.write(HELP);
    return rawArgv.length === 0 ? 2 : 0;
  }
  if (rawArgv[0] === '--version' || rawArgv[0] === '-V') {
    process.stdout.write(readVersion() + '\n');
    return 0;
  }

  const [cmd, ...rest] = rawArgv;
  const { ctx, rest: cmdArgv } = extractGlobalFlags(rest);

  switch (cmd) {
    case 'read':    return readCmd(cmdArgv, ctx);
    case 'list':    return listCmd(cmdArgv, ctx);
    case 'comment': return commentCmd(cmdArgv, ctx);
    case 'suggest': return suggestCmd(cmdArgv, ctx);
    case 'accept':  return acceptCmd(cmdArgv, ctx);
    case 'reject':  return rejectCmd(cmdArgv, ctx);
    case 'resolve': return resolveCmd(cmdArgv, ctx);
    case 'compact': return compactCmd(cmdArgv, ctx);
    case 'serve': {
      // Loaded lazily so the CLI doesn't pay the cost when the server isn't used.
      const { serveCmd } = await import('./commands/serve.js');
      return serveCmd(cmdArgv, ctx);
    }
    default:
      process.stderr.write(`mdc: error: usage — unknown command "${cmd}"\n`);
      process.stderr.write(HELP);
      return 2;
  }
}

const isDirectInvocation = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write('mdc: fatal: ' + (err?.stack ?? String(err)) + '\n');
      process.exit(1);
    });
}
