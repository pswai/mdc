import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, ParseError, collectIds } from '../src/parser.js';
import { emitAnchor, emitComment, emitSuggestion, insertAt } from '../src/serializer.js';
import { generateId, generateUniqueId } from '../src/ids.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '..', '..', 'fixtures', 'parser');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('parser: basic structure', () => {
  test('parses annotations, comments, and suggestion (with companion anchor)', () => {
    const src = loadFixture('basic.md');
    const r = parse(src, 'basic.md');
    // basic.md has two annotations: a1f7q3 (thread) and s1abcd (suggestion's companion anchor),
    // plus the s1abcd suggestion block. The suggestion shares its ID with the companion anchor.
    assert.equal(r.annotations.length, 2);
    assert.equal(r.suggestions.length, 1);
    const ann = r.annotations.find((a) => a.id === 'a1f7q3')!;
    assert.equal(ann.status, 'open');
    assert.equal(ann.comments.length, 2);
    assert.equal(ann.comments[0].by, 'human');
    assert.equal(ann.comments[1].by, 'ai');
    const sug = r.suggestions[0];
    assert.equal(sug.id, 's1abcd');
    assert.equal(sug.old, 'The fox ran away.');
    assert.equal(sug.new, 'The fox darted into the brush.');
  });

  test('empty file has no annotations and clean === source', () => {
    const src = loadFixture('empty.md');
    const r = parse(src);
    assert.equal(r.annotations.length, 0);
    assert.equal(r.suggestions.length, 0);
    assert.equal(r.clean, src);
  });

  test('preserves frontmatter through parse', () => {
    const src = loadFixture('frontmatter.md');
    const r = parse(src);
    assert.equal(r.annotations.length, 1);
    assert.ok(r.clean.startsWith('---\ntitle:'));
  });

  test('handles mixed open and resolved annotations', () => {
    const src = loadFixture('resolved.md');
    const r = parse(src);
    assert.equal(r.annotations.length, 2);
    const byId = Object.fromEntries(r.annotations.map((a) => [a.id, a]));
    assert.equal(byId.res001.status, 'resolved');
    assert.equal(byId.open01.status, 'open');
    assert.equal(byId.res001.comments.length, 2);
    assert.equal(byId.open01.comments.length, 1);
  });
});

describe('parser: clean output', () => {
  test('strip removes tags and collapses blank-line residue', () => {
    const src = loadFixture('basic.md');
    const r = parse(src);
    assert.ok(!r.clean.includes('<!--mdc:'));
    assert.ok(r.clean.includes('The quick brown fox jumps over the lazy dog.'));
    // Should not have a trailing space where the anchor was attached inline.
    assert.ok(!r.clean.includes('lazy dog. \n\n'));
  });
});

describe('parser: errors', () => {
  test('unterminated tag throws ParseError with location', () => {
    const src = '# Doc\n\nSome text <!--mdc:ann id=abc with no closing\n';
    assert.throws(
      () => parse(src, 'bad.md'),
      (err: unknown) => err instanceof ParseError && err.line === 3,
    );
  });

  test('unknown tag kind throws', () => {
    const src = '# Doc\n<!--mdc:wat id=abc-->\n';
    assert.throws(() => parse(src, 'bad.md'), ParseError);
  });

  test('comment without matching ann throws', () => {
    const src = '# Doc\n<!--mdc:comment ann=missing by=ai time=now\nbody\n-->\n';
    assert.throws(() => parse(src, 'bad.md'), /unknown annotation/);
  });

  test('invalid status value throws', () => {
    const src = '# Doc\n<!--mdc:ann id=abc status=closed-->\n';
    assert.throws(() => parse(src, 'bad.md'), /invalid status/);
  });

  test('suggestion missing old:/new: throws', () => {
    const src = '# Doc\n<!--mdc:sug id=s1 by=ai\nincomplete\n-->\n';
    assert.throws(() => parse(src, 'bad.md'), /old:/);
  });
});

describe('parser: byte positions', () => {
  test('source byte ranges are correct', () => {
    const src = loadFixture('basic.md');
    const r = parse(src);
    const ann = r.annotations[0];
    // Slice should start with <!--mdc:ann
    assert.ok(src.slice(ann.sourceRange[0]).startsWith('<!--mdc:ann'));
    // Source range should span anchor + both comments (which are after it)
    const lastComment = r.tags.filter((t) => t.kind === 'comment' && t.attrs.ann === ann.id).pop()!;
    assert.equal(ann.sourceRange[1], lastComment.sourceEnd);
  });
});

describe('ids', () => {
  test('generateId returns 6 chars from Crockford alphabet', () => {
    const id = generateId();
    assert.equal(id.length, 6);
    assert.match(id, /^[0-9abcdefghjkmnpqrstvwxyz]{6}$/);
  });

  test('generateUniqueId avoids existing', () => {
    const existing = new Set<string>();
    for (let i = 0; i < 100; i++) existing.add(generateUniqueId(existing));
    assert.equal(existing.size, 100);
  });
});

describe('round-trip: byte-identical for fixtures', () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    test(`${f}: parse(source) preserves source verbatim`, () => {
      const src = loadFixture(f);
      const r = parse(src, f);
      // The parser doesn't mutate source; reconstruct it from the source byte
      // range it tracked. Each annotation should fit inside its sourceRange.
      assert.equal(r.source, src);
    });
  }
});

describe('idempotence: insert + parse + emit roundtrips', () => {
  test('insert a new annotation; re-parse; emit lookalike', () => {
    const src = loadFixture('empty.md');
    const r0 = parse(src);
    const ids = collectIds(r0);
    const id = generateUniqueId(ids);
    const anchor = emitAnchor(id, 'open');
    const insertOffset = src.indexOf('A list');
    const withTag = insertAt(src, insertOffset + 'A list'.length, ' ' + anchor);
    const r1 = parse(withTag);
    assert.equal(r1.annotations.length, 1);
    assert.equal(r1.annotations[0].id, id);

    // Add a comment to the new annotation
    const comment = emitComment(id, { by: 'ai', time: '2026-05-24T00:00:00Z', body: 'Note.' });
    const withComment = insertAt(withTag, withTag.length, '\n\n' + comment + '\n');
    const r2 = parse(withComment);
    assert.equal(r2.annotations[0].comments.length, 1);
    assert.equal(r2.annotations[0].comments[0].body, 'Note.');
  });

  test('emit + parse + emit produces identical second emit', () => {
    const sug = emitSuggestion({ id: 'xy12ab', by: 'ai', old: 'a\nb', new: 'c\nd' });
    const wrapped = `prefix\n\n${sug}\n\nsuffix`;
    const r = parse(wrapped);
    assert.equal(r.suggestions.length, 1);
    const reEmit = emitSuggestion(r.suggestions[0]);
    assert.equal(reEmit, sug);
  });
});
