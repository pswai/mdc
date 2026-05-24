import * as Y from '/yjs.mjs';

const editor = document.getElementById('editor');
const status = document.getElementById('status');
const peerCount = document.getElementById('peer-count');
const peers = document.getElementById('peers');
const syncState = document.getElementById('sync-state');
const byteCount = document.getElementById('byte-count');
const filename = document.getElementById('filename');

let file = '';
let ws = null;
let applyingRemote = false;
let connected = false;

const doc = new Y.Doc();
const ytext = doc.getText('body');

async function init() {
  const r = await fetch('/api/file-path');
  const j = await r.json();
  file = j.file;
  filename.textContent = `collab — ${file}`;
  connect();
}

function connect() {
  const wsUrl = `ws://${location.host}/api/y/${encodeURIComponent(file)}`;
  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    connected = true;
    status.dataset.state = 'connected';
    status.textContent = 'live';
  };

  ws.onmessage = (ev) => {
    const update = new Uint8Array(ev.data);
    applyingRemote = true;
    try {
      Y.applyUpdate(doc, update);
    } finally {
      applyingRemote = false;
    }
  };

  ws.onclose = () => {
    connected = false;
    status.dataset.state = 'error';
    status.textContent = 'disconnected — reconnecting…';
    setTimeout(connect, 1000);
  };

  ws.onerror = () => {
    status.dataset.state = 'error';
    status.textContent = 'connection error';
  };
}

// When Y.Text changes, mirror it to the textarea (preserving selection)
ytext.observe((event) => {
  void event;
  const text = ytext.toString();
  if (editor.value !== text) {
    const selStart = editor.selectionStart;
    const selEnd = editor.selectionEnd;
    editor.value = text;
    // Best-effort selection restore — not perfect under concurrent edits.
    editor.selectionStart = selStart;
    editor.selectionEnd = selEnd;
  }
  byteCount.textContent = `${new Blob([text]).size} bytes`;
});

// On user edit, compute the delta vs current Y.Text and apply
editor.addEventListener('input', () => {
  if (applyingRemote) return;
  const newText = editor.value;
  const oldText = ytext.toString();
  if (newText === oldText) return;

  // Compute a tiny diff: common prefix + common suffix → middle is what changed.
  let prefix = 0;
  while (
    prefix < oldText.length &&
    prefix < newText.length &&
    oldText[prefix] === newText[prefix]
  ) prefix++;

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (
    oldEnd > prefix &&
    newEnd > prefix &&
    oldText[oldEnd - 1] === newText[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  const removeLen = oldEnd - prefix;
  const insertText = newText.slice(prefix, newEnd);

  doc.transact(() => {
    if (removeLen > 0) ytext.delete(prefix, removeLen);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  });
});

// Send local updates to server
doc.on('update', (update, origin) => {
  if (origin === 'remote') return; // Marker: skip if origin came from remote apply (not used in this minimal impl)
  if (ws && ws.readyState === WebSocket.OPEN && !applyingRemote) {
    ws.send(update);
    syncState.textContent = 'synced ✓';
  } else {
    syncState.textContent = 'queued (offline)';
  }
});

// Peer-presence is not implemented in this minimal demo — show a static "1" plus
// any extra connection a separate tab proves by changing the byte count.
peerCount.textContent = '1+ (count not tracked)';

init();
