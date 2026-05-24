import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const CLI = resolve(REPO, 'dist', 'src', 'cli.js');
const FIXTURES = resolve(REPO, 'fixtures', 'parser');

let workdir: string;

function run(args: string[], opts: { input?: string } = {}): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', input: opts.input });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function tmpFile(name: string, body: string): string {
  const p = join(workdir, name);
  writeFileSync(p, body, 'utf8');
  return p;
}

before(() => {
  workdir = mkdtempSync(join(tmpdir(), 'mdc-cli-test-'));
});

after(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('CLI: --help and --version', () => {
  test('--help prints help and exits 0', () => {
    const r = run(['--help']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Usage: mdc/);
  });

  test('no args prints help and exits 2', () => {
    const r = run([]);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /Usage: mdc/);
  });

  test('--version prints version and exits 0', () => {
    const r = run(['--version']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\d/);
  });

  test('unknown command exits 2', () => {
    const r = run(['nope']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown command/);
  });
});

describe('CLI: read', () => {
  test('read prints file', () => {
    const f = join(FIXTURES, 'basic.md');
    const expected = readFileSync(f, 'utf8');
    const r = run(['read', f]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, expected);
  });

  test('read --clean strips mdc tags', () => {
    const f = join(FIXTURES, 'basic.md');
    const r = run(['read', f, '--clean']);
    assert.equal(r.code, 0);
    assert.ok(!r.stdout.includes('<!--mdc:'));
    assert.ok(r.stdout.includes('The quick brown fox'));
  });

  test('read - reads stdin', () => {
    const r = run(['read', '-'], { input: '# stdin\n\ntext\n' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '# stdin\n\ntext\n');
  });

  test('read missing file exits 1', () => {
    const r = run(['read', '/no/such/file.md']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /runtime/);
  });
});

describe('CLI: list', () => {
  test('list defaults to open items', () => {
    const r = run(['list', join(FIXTURES, 'basic.md')]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /a1f7q3.*annotation/);
    assert.match(r.stdout, /s1abcd.*suggestion/);
  });

  test('list --json emits envelope', () => {
    const r = run(['list', join(FIXTURES, 'basic.md'), '--json']);
    assert.equal(r.code, 0);
    const data = JSON.parse(r.stdout);
    assert.ok(Array.isArray(data.items));
    // basic.md has 2 annotations (one is the suggestion's companion anchor) + 1 suggestion = 3
    assert.equal(data.items.length, 3);
    const suggestionItems = data.items.filter((i: { kind: string }) => i.kind === 'suggestion');
    assert.equal(suggestionItems.length, 1);
  });

  test('list --status resolved filters', () => {
    const r = run(['list', join(FIXTURES, 'resolved.md'), '--status', 'resolved', '--json']);
    assert.equal(r.code, 0);
    const data = JSON.parse(r.stdout);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].id, 'res001');
  });

  test('list --kind suggestion filters', () => {
    const r = run(['list', join(FIXTURES, 'basic.md'), '--kind', 'suggestion', '--json']);
    assert.equal(r.code, 0);
    const data = JSON.parse(r.stdout);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].kind, 'suggestion');
  });
});

describe('CLI: comment', () => {
  test('comment on unique text', () => {
    cpSync(join(FIXTURES, 'empty.md'), tmpFile('a.md', ''));
    const f = tmpFile('a.md', readFileSync(join(FIXTURES, 'empty.md'), 'utf8'));
    const r = run(['comment', f, 'A list', 'numbered?', '--by', 'ai']);
    assert.equal(r.code, 0);
    const after = readFileSync(f, 'utf8');
    assert.match(after, /<!--mdc:ann id=\w+ status=open-->/);
    assert.match(after, /<!--mdc:comment ann=\w+ by=ai/);
    assert.match(after, /numbered\?/);
  });

  test('comment with --json prints annotation', () => {
    const f = tmpFile('b.md', readFileSync(join(FIXTURES, 'empty.md'), 'utf8'));
    const r = run(['comment', f, 'A list', 'note', '--json']);
    assert.equal(r.code, 0);
    const data = JSON.parse(r.stdout);
    assert.equal(data.kind, 'annotation');
    assert.equal(data.comments.length, 1);
    assert.equal(data.comments[0].body, 'note');
  });

  test('comment on duplicate text fails with conflict + match list', () => {
    const body = '# Doc\n\nthe fox jumped.\n\nthen the fox slept.\n\nlater the fox returned.\n';
    const f = tmpFile('dup.md', body);
    const r = run(['comment', f, 'the fox', 'pick one']);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /conflict/);
    assert.match(r.stderr, /appears 3 times/);
    assert.match(r.stderr, /match 1/);
    assert.match(r.stderr, /match 2/);
    assert.match(r.stderr, /match 3/);
    assert.match(r.stderr, /disambiguate with --occurrence/);
  });

  test('comment with --occurrence disambiguates', () => {
    const body = '# Doc\n\nthe fox jumped.\n\nthen the fox slept.\n\nlater the fox returned.\n';
    const f = tmpFile('dup2.md', body);
    const r = run(['comment', f, 'the fox', 'pick this one', '--occurrence', '2']);
    assert.equal(r.code, 0);
    const after = readFileSync(f, 'utf8');
    // The anchor should land after the second "the fox" — in the sentence "then the fox slept"
    assert.match(after, /then the fox<!--mdc:ann/);
  });

  test('comment with --line disambiguates', () => {
    const body = '# Doc\n\nthe fox jumped.\n\nthen the fox slept.\n\nlater the fox returned.\n';
    const f = tmpFile('dup3.md', body);
    const r = run(['comment', f, 'the fox', 'line 7', '--line', '7']);
    assert.equal(r.code, 0);
    const after = readFileSync(f, 'utf8');
    assert.match(after, /later the fox<!--mdc:ann/);
  });

  test('comment with --reply-to appends', () => {
    const f = tmpFile('reply.md', readFileSync(join(FIXTURES, 'basic.md'), 'utf8'));
    const r = run(['comment', f, '', 'follow-up', '--reply-to', 'a1f7q3', '--by', 'human']);
    assert.equal(r.code, 0);
    const after = readFileSync(f, 'utf8');
    assert.match(after, /follow-up/);
    const lr = run(['list', f, '--json']);
    const data = JSON.parse(lr.stdout);
    const ann = data.items.find((i: { id: string }) => i.id === 'a1f7q3');
    assert.equal(ann.comments.length, 3);
    assert.equal(ann.comments[2].body, 'follow-up');
  });

  test('comment with body containing --> exits 5 invalid-input', () => {
    const f = tmpFile('bad.md', readFileSync(join(FIXTURES, 'empty.md'), 'utf8'));
    const r = run(['comment', f, 'A list', 'has --> in it']);
    assert.equal(r.code, 5);
    assert.match(r.stderr, /invalid-input/);
  });
});

describe('CLI: suggest + accept + reject', () => {
  test('suggest then accept replaces text', () => {
    const body = '# Doc\n\nThe fox ran away.\n';
    const f = tmpFile('sug.md', body);
    const sr = run(['suggest', f, 'The fox ran away.', 'The fox darted into the brush.', '--by', 'ai', '--json']);
    assert.equal(sr.code, 0);
    const sug = JSON.parse(sr.stdout);
    const ar = run(['accept', f, sug.id]);
    assert.equal(ar.code, 0);
    const after = readFileSync(f, 'utf8');
    assert.match(after, /The fox darted into the brush\./);
    assert.ok(!after.includes('The fox ran away.'));
    assert.ok(!after.includes('<!--mdc:'));
  });

  test('suggest then reject keeps old text and removes tags', () => {
    const body = '# Doc\n\nThe fox ran away.\n';
    const f = tmpFile('sug2.md', body);
    const sr = run(['suggest', f, 'The fox ran away.', 'replacement.', '--json']);
    const sug = JSON.parse(sr.stdout);
    const rr = run(['reject', f, sug.id]);
    assert.equal(rr.code, 0);
    const after = readFileSync(f, 'utf8');
    assert.match(after, /The fox ran away\./);
    assert.ok(!after.includes('replacement'));
    assert.ok(!after.includes('<!--mdc:'));
  });

  test('accept with non-existent id exits 4', () => {
    const f = tmpFile('miss.md', readFileSync(join(FIXTURES, 'empty.md'), 'utf8'));
    const r = run(['accept', f, 'noexist']);
    assert.equal(r.code, 4);
    assert.match(r.stderr, /not-found/);
  });

  test('accept on annotation id (not suggestion) exits 4', () => {
    const f = tmpFile('wrong.md', readFileSync(join(FIXTURES, 'basic.md'), 'utf8'));
    const r = run(['accept', f, 'a1f7q3']);
    assert.equal(r.code, 4);
    assert.match(r.stderr, /annotation, not a suggestion/);
  });
});

describe('CLI: resolve + compact', () => {
  test('resolve marks status=resolved', () => {
    const f = tmpFile('res.md', readFileSync(join(FIXTURES, 'basic.md'), 'utf8'));
    const r = run(['resolve', f, 'a1f7q3']);
    assert.equal(r.code, 0);
    const after = readFileSync(f, 'utf8');
    assert.match(after, /<!--mdc:ann id=a1f7q3 status=resolved-->/);
  });

  test('compact strips resolved annotations', () => {
    const f = tmpFile('comp.md', readFileSync(join(FIXTURES, 'resolved.md'), 'utf8'));
    const before = readFileSync(f, 'utf8');
    assert.match(before, /res001/);
    const r = run(['compact', f, '--json']);
    assert.equal(r.code, 0);
    const data = JSON.parse(r.stdout);
    assert.deepEqual(data.removed, ['res001']);
    const after = readFileSync(f, 'utf8');
    assert.ok(!after.includes('res001'));
    assert.match(after, /open01/);
  });
});

describe('CLI: round-trip', () => {
  test('comment then read --clean shows body only', () => {
    const f = tmpFile('rt.md', readFileSync(join(FIXTURES, 'empty.md'), 'utf8'));
    run(['comment', f, 'A list', 'note', '--by', 'ai']);
    const r = run(['read', f, '--clean']);
    assert.equal(r.code, 0);
    assert.ok(!r.stdout.includes('<!--mdc:'));
    assert.ok(!r.stdout.includes('note'));
    assert.match(r.stdout, /A list/);
  });
});
