import { spawn } from 'node:child_process';
import { parseArgs, stringFlag, boolFlag, intFlag } from '../args.js';
import type { CliContext, ExitCode } from '../output.js';
import { reportError, EXIT } from '../output.js';
import { startServer } from '../server.js';

export async function serveCmd(argv: string[], ctx: CliContext): Promise<ExitCode> {
  let args;
  try {
    args = parseArgs(argv, new Set(['no-open']));
  } catch (e) {
    return reportError({ code: 'usage', message: (e as Error).message }, ctx);
  }
  if (args.positional.length !== 1) {
    return reportError({ code: 'usage', message: 'mdc serve <file> [--port N] [--bind addr] [--no-open]' }, ctx);
  }
  const file = args.positional[0];
  const wantedPort = intFlag(args, 'port') ?? 8421;
  const bind = stringFlag(args, 'bind') ?? '127.0.0.1';
  const noOpen = boolFlag(args, 'no-open');

  // Try ports wantedPort..wantedPort+9
  let started;
  let lastErr: unknown;
  for (let p = wantedPort; p <= wantedPort + 9; p++) {
    try {
      started = await startServer({ file, port: p, bind, open: !noOpen });
      break;
    } catch (e) {
      lastErr = e;
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') break;
    }
  }
  if (!started) {
    return reportError({ code: 'runtime', message: `failed to bind: ${(lastErr as Error)?.message ?? 'unknown'}` }, ctx);
  }

  const url = `http://${bind}:${started.port}`;
  process.stderr.write(`mdc serve: ${url} (Ctrl-C to stop)\n`);

  if (!noOpen) tryOpen(url);

  await new Promise<void>((resv) => {
    const stop = async () => {
      process.stderr.write('\nmdc serve: shutting down\n');
      await started!.stop();
      resv();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });

  return EXIT.ok;
}

function tryOpen(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* ignore — user can click the URL */
  }
}
