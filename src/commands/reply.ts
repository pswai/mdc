import type { CliContext, ExitCode } from '../output.js';
import { reportError } from '../output.js';
import { commentCmd } from './comment.js';
import { parseArgs } from '../args.js';

/**
 * Ergonomic alias: `mdc reply <file> <id> "<body>" [--by ...] [--json]`
 * is exactly `mdc comment <file> "" "<body>" --reply-to <id>`.
 */
export async function replyCmd(argv: string[], ctx: CliContext): Promise<ExitCode> {
  let args;
  try {
    args = parseArgs(argv, new Set());
  } catch (e) {
    return reportError({ code: 'usage', message: (e as Error).message }, ctx);
  }
  if (args.positional.length !== 3) {
    return reportError({
      code: 'usage',
      message: 'mdc reply <file> <id> "<body>" [--by human|ai] [--json]',
    }, ctx);
  }
  const [file, id, body] = args.positional;
  // Reconstruct flags (preserving --by, --json) and re-dispatch into commentCmd.
  const passthrough: string[] = [];
  for (const [k, v] of args.flags) {
    if (v === true) passthrough.push(`--${k}`);
    else passthrough.push(`--${k}`, String(v));
  }
  return commentCmd([file, '', body, '--reply-to', id, ...passthrough], ctx);
}
