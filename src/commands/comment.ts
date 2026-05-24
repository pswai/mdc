import { readFileSync, writeFileSync } from 'node:fs';
import { parse, ParseError, collectIds } from '../parser.js';
import { parseArgs, stringFlag } from '../args.js';
import {
  findAnchor,
  extractAnchorOptions,
  AnchorConflictError,
  AnchorOffsetMismatchError,
} from '../anchor.js';
import { emitAnchor, emitComment, insertAt, InvalidInputError } from '../serializer.js';
import { generateUniqueId } from '../ids.js';
import { nowIso } from '../utils.js';
import {
  reportError,
  writeJson,
  itemToJson,
  EXIT,
  type CliContext,
  type ExitCode,
  type ErrorMatch,
} from '../output.js';
import type { Author, CommentMessage } from '../types.js';

const FLAGS = new Set<string>();

export async function commentCmd(argv: string[], ctx: CliContext): Promise<ExitCode> {
  let args;
  try {
    args = parseArgs(argv, FLAGS);
  } catch (e) {
    return reportError({ code: 'usage', message: (e as Error).message }, ctx);
  }

  if (args.positional.length !== 3) {
    return reportError({
      code: 'usage',
      message: 'mdc comment <file> "<quoted-text>" "<body>" [--reply-to <id>] [--by human|ai] [--line N] [--occurrence N] [--after "<context>"] [--before "<context>"] [--offset N] [--json]',
    }, ctx);
  }

  const [file, quotedText, body] = args.positional;
  const replyTo = stringFlag(args, 'reply-to');
  const by = (stringFlag(args, 'by') ?? process.env.MDC_AUTHOR ?? 'human') as Author;
  if (by !== 'human' && by !== 'ai') {
    return reportError({ code: 'usage', message: `--by must be human|ai; got "${by}"` }, ctx);
  }

  if (body.includes('-->')) {
    return reportError({ code: 'invalid-input', message: 'comment body contains forbidden sequence "-->"' }, ctx);
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

  let opts;
  try {
    opts = extractAnchorOptions((n) => stringFlag(args, n));
  } catch (e) {
    return reportError({ code: 'usage', message: (e as Error).message }, ctx);
  }

  const message: CommentMessage = { by, time: nowIso(), body };

  // Reply path
  if (replyTo) {
    const ann = r.annotations.find((a) => a.id === replyTo);
    if (!ann) {
      return reportError({ code: 'not-found', message: `--reply-to id "${replyTo}" not found` }, ctx);
    }
    // Insert the new comment right after the last existing tag of this annotation
    let commentText: string;
    try {
      commentText = emitComment(replyTo, message);
    } catch (e) {
      if (e instanceof InvalidInputError) {
        return reportError({ code: 'invalid-input', message: e.message }, ctx);
      }
      throw e;
    }
    const insertOffset = ann.sourceRange[1];
    const needsLeadingNewline = source[insertOffset - 1] !== '\n';
    const updated = insertAt(source, insertOffset, (needsLeadingNewline ? '\n\n' : '\n') + commentText);
    try {
      writeFileSync(file, updated, 'utf8');
    } catch (e) {
      return reportError({ code: 'runtime', message: `cannot write ${file}: ${(e as Error).message}` }, ctx);
    }
    if (ctx.json) {
      const r2 = parse(updated, file);
      const ann2 = r2.annotations.find((a) => a.id === replyTo)!;
      writeJson(itemToJson(ann2));
    }
    return EXIT.ok;
  }

  // New-thread path: requires non-empty quoted text
  if (quotedText.length === 0) {
    return reportError({ code: 'usage', message: 'empty <quoted-text> requires --reply-to' }, ctx);
  }

  // Find anchor
  let anchor;
  try {
    anchor = findAnchor(source, r.tags, quotedText, opts, file);
  } catch (e) {
    if (e instanceof AnchorConflictError) {
      const matches: ErrorMatch[] = e.matches.map((m) => ({ line: m.line, col: m.col, snippet: m.snippet, offset: m.start }));
      return reportError({
        code: 'conflict',
        message: e.message,
        context: { matches },
      }, ctx);
    }
    if (e instanceof AnchorOffsetMismatchError) {
      return reportError({ code: 'conflict', message: e.message }, ctx);
    }
    throw e;
  }

  // Generate unique ID
  const id = generateUniqueId(collectIds(r));
  const anchorTag = emitAnchor(id, 'open');
  let commentText: string;
  try {
    commentText = emitComment(id, message);
  } catch (e) {
    if (e instanceof InvalidInputError) {
      return reportError({ code: 'invalid-input', message: e.message }, ctx);
    }
    throw e;
  }

  // Insert anchor immediately after the matched text
  const anchorInsertOffset = anchor.start + quotedText.length;
  const nextChar = source[anchorInsertOffset];
  const inserted = insertAt(source, anchorInsertOffset, (nextChar === ' ' || nextChar === '\n' ? '' : ' ') + anchorTag);

  // Append comment block after the line containing the anchor
  const afterAnchorOffset = anchorInsertOffset + (nextChar === ' ' || nextChar === '\n' ? 0 : 1) + anchorTag.length;
  const lineEnd = inserted.indexOf('\n', afterAnchorOffset);
  const insertCommentAt = lineEnd === -1 ? inserted.length : lineEnd;
  const commentInsert = (insertCommentAt < inserted.length && inserted[insertCommentAt + 1] === '\n' ? '\n' : '\n\n') + commentText;
  const final = insertAt(inserted, insertCommentAt, commentInsert);

  try {
    writeFileSync(file, final, 'utf8');
  } catch (e) {
    return reportError({ code: 'runtime', message: `cannot write ${file}: ${(e as Error).message}` }, ctx);
  }

  if (ctx.json) {
    const r2 = parse(final, file);
    const ann2 = r2.annotations.find((a) => a.id === id)!;
    writeJson(itemToJson(ann2));
  }
  return EXIT.ok;
}
