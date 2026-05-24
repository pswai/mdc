import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import type { Server as HttpServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Minimal Yjs-over-WebSocket session for a single markdown file.
 *
 * Wire protocol — deliberately tiny, NOT the full y-websocket protocol:
 *   - On client connect: server sends Y.encodeStateAsUpdate(doc) (full state).
 *   - Subsequent binary messages from a client are treated as Y.applyUpdate
 *     payloads; the server applies them locally then broadcasts to every
 *     other connected client.
 *   - Clients are responsible for not echoing their own updates back.
 *
 * Persistence: when the in-memory doc's Y.Text changes, the server debounces
 * and rewrites the underlying .md file with the new content. External edits
 * to the file are NOT merged back into the live Y.Doc in this demo (real
 * Y.js apps usually use IndexedDB + y-leveldb on the server for this).
 */

const FIELD = 'body';
const PERSIST_DEBOUNCE_MS = 500;

interface CollabSession {
  doc: Y.Doc;
  clients: Set<WebSocket>;
  persistTimer: NodeJS.Timeout | undefined;
}

export class CollabHub {
  private sessions = new Map<string, CollabSession>();
  private wss: WebSocketServer;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
  }

  /** Attach to an existing http.Server, listening on /api/y/<encoded-file>. */
  attach(server: HttpServer): void {
    server.on('upgrade', (req, socket, head) => {
      const url = req.url ?? '/';
      if (!url.startsWith('/api/y/')) {
        socket.destroy();
        return;
      }
      const filePath = decodeURIComponent(url.slice('/api/y/'.length));
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.handleConnection(ws, filePath);
      });
    });
  }

  private handleConnection(ws: WebSocket, filePath: string): void {
    const session = this.getOrCreate(filePath);
    session.clients.add(ws);

    // Initial sync: send full doc state as a single update.
    const state = Y.encodeStateAsUpdate(session.doc);
    ws.send(state);

    ws.on('message', (data: Buffer) => {
      try {
        const update = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        Y.applyUpdate(session.doc, update);
        for (const client of session.clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(update);
          }
        }
      } catch (err) {
        // Malformed update — ignore; client will get inconsistent state and can refresh.
        process.stderr.write(`collab: bad update from client: ${(err as Error).message}\n`);
      }
    });

    ws.on('close', () => {
      session.clients.delete(ws);
      // Don't tear down the session — file persistence happens on Y.Text change,
      // and a new client might join immediately.
    });
  }

  private getOrCreate(filePath: string): CollabSession {
    const existing = this.sessions.get(filePath);
    if (existing) return existing;

    const doc = new Y.Doc();
    const text = doc.getText(FIELD);
    try {
      text.insert(0, readFileSync(filePath, 'utf8'));
    } catch (err) {
      process.stderr.write(`collab: cannot seed session from ${filePath}: ${(err as Error).message}\n`);
    }

    const session: CollabSession = { doc, clients: new Set(), persistTimer: undefined };

    text.observe(() => {
      clearTimeout(session.persistTimer);
      session.persistTimer = setTimeout(() => {
        try {
          writeFileSync(filePath, text.toString(), 'utf8');
        } catch (err) {
          process.stderr.write(`collab: cannot persist ${filePath}: ${(err as Error).message}\n`);
        }
      }, PERSIST_DEBOUNCE_MS);
    });

    this.sessions.set(filePath, session);
    return session;
  }

  shutdown(): void {
    for (const session of this.sessions.values()) {
      clearTimeout(session.persistTimer);
      for (const ws of session.clients) {
        try { ws.close(); } catch { /* noop */ }
      }
    }
    this.sessions.clear();
    this.wss.close();
  }
}
