// mdc serve — minimal browser client.
// Architecture: fetch /api/state on load and on every SSE 'change' event.
// Render rendered HTML into #doc. Walk for data-mdc-anchor placeholders;
// for each, wrap the immediately-preceding text node fragment with a highlight mark
// that links to its annotation/suggestion in the side rail. Reply / accept / reject
// post to the matching /api/* endpoint, which shells out to the CLI.

const doc = document.getElementById('doc');
const rail = document.getElementById('rail');
const status = document.getElementById('status');
const filenameEl = document.getElementById('filename');

let state = { annotations: [], suggestions: [] };
let activeId = null;

async function fetchState() {
  try {
    const r = await fetch('/api/state');
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    state = j;
    filenameEl.textContent = j.file || '';
    renderDoc(j.html || '');
    renderRail();
  } catch (e) {
    toast('failed to load state: ' + e.message);
  }
}

function renderDoc(html) {
  doc.innerHTML = html;
  // Find all anchor placeholders and convert into highlight marks
  const placeholders = [...doc.querySelectorAll('span[data-mdc-anchor]')];
  for (const span of placeholders) {
    const id = span.dataset.mdcAnchor;
    const kind = span.dataset.mdcKind || 'annotation';
    const status = stateStatusFor(id);
    // Wrap the previous sibling text content (best-effort: take last text leaf in previous element/text)
    const target = findHighlightTarget(span);
    if (target) {
      wrapHighlight(target, id, kind, status);
    }
    // Remove the placeholder span
    span.remove();
  }
  // Click handler for highlights
  doc.addEventListener('click', onDocClick);
}

function onDocClick(e) {
  const mark = e.target.closest('mark.mdc-anchor-highlight');
  if (!mark) return;
  const id = mark.dataset.id;
  setActive(id, { scrollIntoView: 'rail' });
}

function findHighlightTarget(span) {
  // Walk back to find the immediately-preceding text content. Strategy: collect text
  // nodes between span and the previous non-text sibling (or start of parent).
  // The "anchored text" is whatever immediately precedes the span — for v0 we take
  // the previous text node (or, if span follows an inline element, that element's last text).
  const prev = span.previousSibling;
  if (!prev) return null;
  if (prev.nodeType === Node.TEXT_NODE) {
    // Use the last word(s) of the text node — heuristically, anchor to the last
    // contiguous non-whitespace run plus one trailing word if short. For now,
    // wrap the entire previous text node if it's short, otherwise the last ~3 words.
    return { kind: 'text', node: prev };
  }
  if (prev.nodeType === Node.ELEMENT_NODE) {
    // Find last text leaf in the element
    let cur = prev;
    while (cur && cur.lastChild) cur = cur.lastChild;
    if (cur && cur.nodeType === Node.TEXT_NODE) return { kind: 'text', node: cur };
    return { kind: 'element', node: prev };
  }
  return null;
}

function wrapHighlight(target, id, kind, status) {
  const cls = `mdc-anchor-highlight kind-${kind} status-${status}`;
  if (target.kind === 'text') {
    const node = target.node;
    const text = node.textContent;
    // Choose how much to wrap. Heuristic: if text ends with punctuation+space (sentence end),
    // wrap the trailing sentence fragment. Otherwise wrap the last 6 words.
    const m = text.match(/[^.!?\n]{1,80}$/);
    const wrapText = m ? m[0].replace(/^\s+/, '') : text;
    const wrapStart = text.length - wrapText.length;
    const before = text.slice(0, wrapStart);
    const beforeNode = document.createTextNode(before);
    const mark = document.createElement('mark');
    mark.className = cls;
    mark.dataset.id = id;
    mark.textContent = wrapText;
    node.replaceWith(beforeNode, mark);
  } else {
    // Element: just append a class — less precise, but at least styled.
    target.node.classList.add('mdc-anchor-highlight', `kind-${kind}`, `status-${status}`);
    target.node.dataset.id = id;
  }
}

function stateStatusFor(id) {
  const ann = state.annotations.find(a => a.id === id);
  if (ann) return ann.status;
  // Suggestion anchors don't have status; treat as "open"
  return 'open';
}

function renderRail() {
  rail.innerHTML = '';
  const items = [
    ...state.annotations.map(a => ({ ...a, _kind: 'annotation' })),
    ...state.suggestions.map(s => ({ ...s, _kind: 'suggestion' })),
  ];
  if (items.length === 0) {
    rail.innerHTML = '<div class="rail-empty">No annotations yet.<br>Use <code>mdc comment</code> from your terminal.</div>';
    return;
  }
  for (const item of items) {
    if (item._kind === 'annotation') rail.appendChild(renderThread(item));
    else rail.appendChild(renderSuggestion(item));
  }
}

function renderThread(ann) {
  const tpl = document.getElementById('tpl-thread');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = ann.id;
  node.querySelector('.thread-id').textContent = ann.id;
  node.querySelector('.thread-status').textContent = ann.status;
  const comments = node.querySelector('.thread-comments');
  for (const c of ann.comments) {
    const div = document.createElement('div');
    div.className = 'comment';
    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    meta.innerHTML = `<span class="by-${c.by}">${c.by}</span> · ${formatTime(c.time)}`;
    const body = document.createElement('div');
    body.className = 'comment-body';
    body.textContent = c.body;
    div.appendChild(meta);
    div.appendChild(body);
    comments.appendChild(div);
  }
  node.querySelector('.thread-resolve').addEventListener('click', () => act('resolve', { id: ann.id }));
  node.querySelector('.thread-reply').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const body = form.body.value.trim();
    if (!body) return;
    const by = form.by.value;
    act('comment', { replyTo: ann.id, body, by, quotedText: '' }).then(() => { form.body.value = ''; });
  });
  return node;
}

function renderSuggestion(sug) {
  const tpl = document.getElementById('tpl-suggestion');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = sug.id;
  node.querySelector('.thread-id').textContent = sug.id;
  node.querySelector('.sug-old').textContent = sug.old;
  node.querySelector('.sug-new').textContent = sug.new;
  node.querySelector('.sug-accept').addEventListener('click', () => act('accept', { id: sug.id }));
  node.querySelector('.sug-reject').addEventListener('click', () => act('reject', { id: sug.id }));
  return node;
}

function setActive(id, opts = {}) {
  activeId = id;
  for (const m of doc.querySelectorAll('mark.mdc-anchor-highlight')) {
    m.classList.toggle('is-active', m.dataset.id === id);
  }
  for (const t of rail.querySelectorAll('[data-id]')) {
    t.classList.toggle('is-active', t.dataset.id === id);
  }
  if (opts.scrollIntoView === 'rail') {
    const target = rail.querySelector(`[data-id="${id}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (opts.scrollIntoView === 'doc') {
    const target = doc.querySelector(`mark[data-id="${id}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function act(cmd, payload) {
  try {
    const r = await fetch('/api/' + cmd, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (j.error) {
      toast(`${cmd} failed: ${j.error.code} — ${j.error.message}`);
    }
  } catch (e) {
    toast(cmd + ' network error: ' + e.message);
  }
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleString(undefined, sameYear ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function connectSse() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', () => status.dataset.state = 'connected', { once: true });
  es.addEventListener('change', () => { fetchState(); });
  es.onerror = () => {
    status.dataset.state = 'error';
    status.textContent = 'reconnecting…';
  };
  es.onopen = () => {
    status.dataset.state = 'connected';
    status.textContent = 'live';
  };
}

// Keyboard floor: J/K next/prev, R reply (focus first composer), A/X for suggestions, E to resolve
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const ids = [...rail.querySelectorAll('[data-id]')].map(n => n.dataset.id);
  if (ids.length === 0) return;
  const idx = activeId ? ids.indexOf(activeId) : -1;
  if (e.key === 'j') {
    setActive(ids[Math.min(ids.length - 1, idx + 1)], { scrollIntoView: 'doc' });
    e.preventDefault();
  } else if (e.key === 'k') {
    setActive(ids[Math.max(0, idx - 1)], { scrollIntoView: 'doc' });
    e.preventDefault();
  } else if (e.key === 'e' && activeId) {
    act('resolve', { id: activeId });
    e.preventDefault();
  } else if (e.key === 'a' && activeId) {
    act('accept', { id: activeId });
    e.preventDefault();
  } else if (e.key === 'x' && activeId) {
    act('reject', { id: activeId });
    e.preventDefault();
  } else if (e.key === 'r' && activeId) {
    const form = rail.querySelector(`[data-id="${activeId}"] textarea`);
    form?.focus();
    e.preventDefault();
  }
});

fetchState();
connectSse();
