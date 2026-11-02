const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scanRoot, createWorkspaceIndex, authorizedPath, within, readMarkdown, saveMarkdown, createMarkdown } = require('../electron/workspace.cjs');

test('folder indexing publishes each result without waiting for slow roots, caches reads, and coalesces refreshes', async () => {
  const pending = new Map();
  const calls = [];
  let changes = 0;
  const index = createWorkspaceIndex(() => changes++, (root) => {
    calls.push(root);
    return new Promise((resolve, reject) => pending.set(root, { resolve, reject }));
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const slow = path.resolve('slow');
  const fast = path.resolve('fast');
  const added = path.resolve('added');
  const result = (root, count) => ({ path: root, name: path.basename(root), children: [], count, error: null });
  assert.ok(index.snapshot([slow, fast]).every((root) => root.loading));
  await tick();
  pending.get(fast).resolve(result(fast, 6));
  await tick();
  let roots = index.snapshot([slow, fast]);
  assert.equal(roots[0].loading, true);
  assert.equal(roots[1].count, 6);
  assert.equal(roots[1].loading, false);
  assert.equal(changes, 1);
  index.snapshot([slow, fast, added]);
  await tick();
  assert.deepEqual(calls, [slow, fast, added], 'adding a root and reading snapshots do not rescan existing roots');
  index.refresh(fast);
  index.refresh(fast);
  index.refresh(fast);
  await tick();
  assert.equal(calls.filter((root) => root === fast).length, 2, 'only one scan per root runs at a time');
  assert.equal(index.snapshot([slow, fast, added])[1].count, 6, 'refresh keeps the previous tree visible');
  pending.get(fast).resolve(result(fast, 7));
  await tick();
  assert.equal(calls.filter((root) => root === fast).length, 3, 'changes during a scan schedule one follow-up');
  pending.get(fast).resolve(result(fast, 8));
  pending.get(added).reject(new Error('unreadable'));
  await tick();
  roots = index.snapshot([slow, fast, added]);
  assert.equal(roots[1].count, 8);
  assert.equal(roots[1].loading, false);
  assert.deepEqual(roots[2].error, { key: 'unreadableFolders', count: 1 });
  index.snapshot([fast, added]);
  const before = changes;
  pending.get(slow).resolve(result(slow, 100));
  await tick();
  assert.equal(changes, before, 'removed roots cannot publish late results');
  assert.deepEqual(index.snapshot([fast, added]).map((root) => root.path), [fast, added]);
});

test('only Markdown files and their parent folders appear, including nested and uppercase names', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdesk-scan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const folder of ['notes/deep', 'empty', 'node_modules/library', '.git', 'images']) await fs.mkdir(path.join(root, folder), { recursive: true });
  for (const name of ['README.md', 'notes/PLAN.MD', 'notes/deep/spec.markdown', 'notes/code.js', 'images/photo.png', 'node_modules/library/README.md', '.git/secret.md']) await fs.writeFile(path.join(root, name), 'test');
  const result = await scanRoot(root);
  assert.equal(result.count, 3);
  assert.deepEqual(result.children.map((node) => node.name), ['notes', 'README.md']);
  assert.equal(result.children[0].children[0].children[0].name, 'spec.markdown');
  assert.equal(result.error, null);
});

test('access is restricted to registered real paths, not adjacent folders or traversal', async (t) => {
  const container = await fs.mkdtemp(path.join(os.tmpdir(), 'markdesk-path-'));
  t.after(() => fs.rm(container, { recursive: true, force: true }));
  const root = path.join(container, 'docs');
  const adjacent = path.join(container, 'docs-other');
  await fs.mkdir(root); await fs.mkdir(adjacent);
  const inside = path.join(root, 'note.md'); const outside = path.join(adjacent, 'secret.md');
  await fs.writeFile(inside, 'ok'); await fs.writeFile(outside, 'private');
  assert.equal(await authorizedPath(inside, [root]), await fs.realpath(inside));
  await assert.rejects(authorizedPath(outside, [root]));
  await assert.rejects(authorizedPath(path.join(root, '..', 'docs-other', 'secret.md'), [root]));
  await assert.rejects(authorizedPath('relative.md', [root]));
  assert.equal(within(root, adjacent), false);
});

test('a missing folder remains visible with an error', async () => {
  const result = await scanRoot(path.join(os.tmpdir(), 'markdesk-does-not-exist-827362'));
  assert.equal(result.count, 0);
  assert.deepEqual(result.error, { key: 'unreadableFolders', count: 1 });
});

test('editing preserves BOM and CRLF, and rejects stale revisions without changing the file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdesk-edit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'note.md');
  await fs.writeFile(file, '\uFEFF# Original\r\n\r\nText\r\n');
  const original = await readMarkdown(file, [root]);
  assert.equal(original.content, '# Original\r\n\r\nText\r\n');
  const saved = await saveMarkdown(file, '# Edited\n\n한글 日本語\n', original.revision, [root]);
  assert.equal(await fs.readFile(file, 'utf8'), '\uFEFF# Edited\r\n\r\n한글 日本語\r\n');
  assert.equal(saved.revision, (await readMarkdown(file, [root])).revision);
  await fs.writeFile(file, '# External change');
  await assert.rejects(saveMarkdown(file, 'stale text', saved.revision, [root]), /fileConflict/);
  assert.equal(await fs.readFile(file, 'utf8'), '# External change');
  assert.deepEqual(await fs.readdir(root), ['note.md'], 'temporary files are cleaned up');
  await assert.rejects(saveMarkdown(file, 'x'.repeat(20 * 1024 * 1024 + 1), (await readMarkdown(file, [root])).revision, [root]), /fileTooLarge/);
});

test('creation is exclusive and all writes stay inside registered folders', async (t) => {
  const container = await fs.mkdtemp(path.join(os.tmpdir(), 'markdesk-create-'));
  t.after(() => fs.rm(container, { recursive: true, force: true }));
  const root = path.join(container, 'docs');
  await fs.mkdir(root);
  const file = path.join(root, '새 문서.md');
  assert.equal(await createMarkdown(file, [root]), file);
  await fs.writeFile(file, 'keep');
  await assert.rejects(createMarkdown(file, [root]), /fileExists/);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep');
  for (const name of ['bad.txt', 'CON.md', 'bad?.md']) await assert.rejects(createMarkdown(path.join(root, name), [root]), /invalidFilename/);
  const outside = path.join(container, 'outside.md');
  await fs.writeFile(outside, 'private');
  await assert.rejects(createMarkdown(path.join(container, 'new.md'), [root]), /registeredOnly/);
  await assert.rejects(saveMarkdown(outside, 'overwrite', 'revision', [root]), /registeredOnly/);
  await fs.writeFile(path.join(root, 'code.js'), 'source');
  await assert.rejects(saveMarkdown(path.join(root, 'code.js'), 'overwrite', 'revision', [root]), /markdownOnly/);
});

test('slash completion recognizes word boundaries and filters labels or command names', async () => {
  const { slashMatch, matchingCommands } = await import('../src/slash-commands.mjs');
  assert.deepEqual(slashMatch('hello\n/ta', 9), { start: 6, query: 'ta' });
  assert.deepEqual(slashMatch('/', 1), { start: 0, query: '' });
  for (const text of ['https://', 'path/file', '/two words']) assert.equal(slashMatch(text, text.length), null);
  const label = key => ({ table: '표', taskList: '체크리스트' })[key] || key;
  assert.equal(matchingCommands('table', label)[0].id, 'table');
  assert.equal(matchingCommands('체크', label)[0].id, 'task');
  assert.deepEqual(matchingCommands('no-command-matches', label), []);
});
