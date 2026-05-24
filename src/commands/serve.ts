import type { CliContext, ExitCode } from '../output.js';
import { reportError } from '../output.js';

/** Placeholder until Phase 3 lands the real preview server. */
export async function serveCmd(_argv: string[], ctx: CliContext): Promise<ExitCode> {
  return reportError({
    code: 'runtime',
    message: 'mdc serve is not yet implemented in this experiment slice; coming in Phase 3.',
  }, ctx);
}
