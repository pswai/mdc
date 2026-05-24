export interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

/**
 * Tiny flag parser.
 * - Long flags: `--foo value`, `--foo=value`, or `--foo` (boolean)
 * - Short flags: `-f value` or `-f` (boolean)
 * - `--` ends flag parsing; everything after is positional
 * Pass the set of boolean (no-value) flag names so the parser knows
 * which flags consume the next argv element vs. which stand alone.
 */
export function parseArgs(argv: string[], boolFlags: Set<string> = new Set()): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
      } else {
        const name = a.slice(2);
        if (boolFlags.has(name)) {
          flags.set(name, true);
        } else {
          if (i + 1 >= argv.length) {
            throw new UsageError(`flag --${name} requires a value`);
          }
          flags.set(name, argv[i + 1]);
          i++;
        }
      }
    } else if (a.startsWith('-') && a.length === 2) {
      const name = a.slice(1);
      if (boolFlags.has(name)) {
        flags.set(name, true);
      } else {
        if (i + 1 >= argv.length) {
          throw new UsageError(`flag -${name} requires a value`);
        }
        flags.set(name, argv[i + 1]);
        i++;
      }
    } else {
      positional.push(a);
    }
    i++;
  }
  return { positional, flags };
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags.get(name);
  if (v === undefined || v === true || v === false) return undefined;
  return v;
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

export function intFlag(args: ParsedArgs, name: string): number | undefined {
  const v = stringFlag(args, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new UsageError(`flag --${name} must be an integer; got "${v}"`);
  }
  return n;
}
