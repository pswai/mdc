import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { watch, existsSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { marked } from 'marked';

import { parse, ParseError, displayableItems } from './parser.js';
import type { Annotation, Suggestion } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/src/server.js → repo root is two levels up
const REPO_ROOT = resolve(__dirname, '..', '..');
const WEB_DIR = resolve(REPO_ROOT, 'web');
const CLI_PATH = resolve(REPO_ROOT, 'dist', 'src', 'cli.js');

export interface ServeOptions {
  file: string;
  port: number;
  bind: string;
  open: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

interface SseClient {
  res: ServerResponse;
}

export async function startServer(opts: ServeOptions): Promise<{ stop: () => Promise<void>; port: number }> {
  if (!existsSync(opts.file)) {
    throw new Error(`file not found: ${opts.file}`);
  }
  if (!existsSync(WEB_DIR)) {
    throw new Error(`web assets missing at ${WEB_DIR}`);
  }

  const sseClients = new Set<SseClient>();

  const broadcastChange = () => {
    const data = `event: change\ndata: ${Date.now()}\n\n`;
    for (const c of sseClients) {
      try {
        c.res.write(data);
      } catch {
        // ignore broken pipes
      }
    }
  };

  // Watch file with light debounce (fs.watch can fire multiple events per save)
  let debounceTimer: NodeJS.Timeout | undefined;
  const watcher = watch(opts.file, () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(broadcastChange, 50);
  });

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, opts, sseClients);
    } catch (err) {
      respondJson(res, 500, { error: { code: 'runtime', message: (err as Error).message } });
    }
  });

  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(opts.port, opts.bind, () => res());
  });

  const actualPort = (server.address() as { port: number }).port;

  return {
    port: actualPort,
    stop: async () => {
      watcher.close();
      for (const c of sseClients) {
        try { c.res.end(); } catch { /* noop */ }
      }
      sseClients.clear();
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ServeOptions,
  sseClients: Set<SseClient>,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // Static assets
  if (method === 'GET' && (path === '/' || path === '/index.html')) {
    await serveStatic(res, 'index.html');
    return;
  }
  if (method === 'GET' && (path === '/app.js' || path === '/styles.css')) {
    await serveStatic(res, path.slice(1));
    return;
  }

  // API
  if (method === 'GET' && path === '/api/state') {
    await apiState(res, opts.file);
    return;
  }
  if (method === 'GET' && path === '/api/events') {
    apiEvents(req, res, sseClients);
    return;
  }
  if (method === 'POST' && path.startsWith('/api/')) {
    const cmd = path.slice('/api/'.length);
    if (!['comment', 'suggest', 'accept', 'reject', 'resolve'].includes(cmd)) {
      respondJson(res, 404, { error: { code: 'not-found', message: `unknown api ${cmd}` } });
      return;
    }
    await apiCall(req, res, cmd, opts.file);
    return;
  }

  res.statusCode = 404;
  res.setHeader('content-type', 'text/plain');
  res.end('not found');
}

async function serveStatic(res: ServerResponse, name: string): Promise<void> {
  const path = resolve(WEB_DIR, name);
  if (!path.startsWith(WEB_DIR)) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  const body = await readFile(path);
  res.statusCode = 200;
  res.setHeader('content-type', MIME[extname(name)] ?? 'application/octet-stream');
  res.setHeader('cache-control', 'no-cache');
  res.end(body);
}

async function apiState(res: ServerResponse, file: string): Promise<void> {
  let source: string;
  try {
    source = (await readFile(file)).toString('utf8');
  } catch (e) {
    respondJson(res, 500, { error: { code: 'runtime', message: `cannot read file: ${(e as Error).message}` } });
    return;
  }
  let parsed;
  try {
    parsed = parse(source, file);
  } catch (e) {
    if (e instanceof ParseError) {
      respondJson(res, 200, {
        error: { code: 'runtime', message: e.reason, at: { file: e.file, line: e.line, col: e.col } },
        partial: true,
      });
      return;
    }
    throw e;
  }
  // Preprocess source: replace mdc:ann tags with span placeholders so we can highlight
  // anchored text in the rendered HTML on the client side. Comments/suggestions are stripped
  // from the rendered body (they appear in the side panel).
  const renderableSource = preRender(parsed);
  const html = marked.parse(renderableSource, { async: false }) as string;
  const visible = displayableItems(parsed);
  respondJson(res, 200, {
    file,
    html,
    annotations: visible.filter((i): i is Annotation => i.kind === 'annotation').map(asJson),
    suggestions: visible.filter((i): i is Suggestion => i.kind === 'suggestion').map(asJson),
  });
}

function asJson(item: Annotation | Suggestion): object {
  if (item.kind === 'annotation') {
    return {
      kind: 'annotation',
      id: item.id,
      status: item.status,
      anchor: item.anchor,
      comments: item.comments,
    };
  }
  return {
    kind: 'suggestion',
    id: item.id,
    by: item.by,
    anchor: item.anchor,
    old: item.old,
    new: item.new,
  };
}

function preRender(parsed: { source: string; tags: ReturnType<typeof parse>['tags']; annotations: Annotation[]; suggestions: Suggestion[] }): string {
  // Replace anchor tags with <span data-mdc-anchor="ID" data-mdc-status="open">…</span>.
  // Strip comment and suggestion tags entirely (rendered in the side panel).
  // For suggestion's inline anchor, treat it the same as a comment's anchor (it has an mdc:ann inline).
  const ranges: Array<{ start: number; end: number; replacement: string }> = [];
  const annStatusById = new Map(parsed.annotations.map((a) => [a.id, a.status]));
  // Suggestions also create inline mdc:ann tags (per suggest command), so they're in parsed.tags already.
  const suggestionIds = new Set(parsed.suggestions.map((s) => s.id));
  for (const tag of parsed.tags) {
    if (tag.kind === 'ann') {
      const id = tag.attrs.id;
      const status = annStatusById.get(id) ?? 'open';
      const isSuggestion = suggestionIds.has(id);
      const cls = isSuggestion ? 'mdc-anchor mdc-suggestion-anchor' : `mdc-anchor mdc-status-${status}`;
      ranges.push({
        start: tag.sourceStart,
        end: tag.sourceEnd,
        replacement: `<span class="${cls}" data-mdc-anchor="${id}" data-mdc-kind="${isSuggestion ? 'suggestion' : 'annotation'}"></span>`,
      });
    } else {
      // Strip comment/sug body tags from rendered output; eat trailing newline if alone on a line.
      let start = tag.sourceStart;
      let end = tag.sourceEnd;
      const prevChar = start > 0 ? parsed.source[start - 1] : '\n';
      const nextChar = end < parsed.source.length ? parsed.source[end] : '';
      if ((prevChar === '\n' || start === 0) && nextChar === '\n') {
        end += 1;
      }
      ranges.push({ start, end, replacement: '' });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  let out = '';
  let last = 0;
  for (const r of ranges) {
    out += parsed.source.slice(last, r.start) + r.replacement;
    last = r.end;
  }
  out += parsed.source.slice(last);
  return out;
}

function apiEvents(_req: IncomingMessage, res: ServerResponse, clients: Set<SseClient>): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.write('event: hello\ndata: connected\n\n');
  const client = { res };
  clients.add(client);
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* noop */ }
  }, 25000);
  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

async function apiCall(req: IncomingMessage, res: ServerResponse, cmd: string, file: string): Promise<void> {
  let body: string;
  try {
    body = await readBody(req);
  } catch (e) {
    respondJson(res, 400, { error: { code: 'runtime', message: `bad body: ${(e as Error).message}` } });
    return;
  }
  let payload: Record<string, string>;
  try {
    payload = JSON.parse(body);
  } catch {
    respondJson(res, 400, { error: { code: 'runtime', message: 'invalid JSON body' } });
    return;
  }

  const args: string[] = [cmd, file];
  if (cmd === 'comment') {
    args.push(payload.quotedText ?? '', payload.body ?? '');
    if (payload.replyTo) args.push('--reply-to', payload.replyTo);
    if (payload.by) args.push('--by', payload.by);
    if (payload.offset !== undefined) args.push('--offset', String(payload.offset));
  } else if (cmd === 'suggest') {
    args.push(payload.oldText ?? '', payload.newText ?? '');
    if (payload.by) args.push('--by', payload.by);
    if (payload.offset !== undefined) args.push('--offset', String(payload.offset));
  } else if (cmd === 'accept' || cmd === 'reject' || cmd === 'resolve') {
    args.push(payload.id ?? '');
  }
  args.push('--json');

  const child = spawn(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, MDC_AUTHOR: payload.by ?? process.env.MDC_AUTHOR ?? 'human' },
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise<number>((resv) => child.on('close', (c) => resv(c ?? 1)));
  if (code === 0) {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(out || '{}');
  } else {
    let errObj: object | null = null;
    try {
      errObj = JSON.parse(out);
    } catch { /* fallthrough */ }
    if (!errObj) errObj = { error: { code: code === 2 ? 'usage' : code === 3 ? 'conflict' : code === 4 ? 'not-found' : code === 5 ? 'invalid-input' : 'runtime', message: err.trim() || 'cli failed' } };
    res.statusCode = 200; // browser handles error via envelope
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(errObj));
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function respondJson(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

void writeFile;
