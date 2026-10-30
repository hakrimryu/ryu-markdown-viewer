const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const MARKDOWN = /\.(md|markdown)$/i;
const IGNORED = new Set(['.git', 'node_modules', '.svn', '.hg']);
function within(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function authorizedPath(file, roots) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('invalidPath');
  const real = await fs.realpath(file);
  if (!roots.some((root) => within(root, real))) throw new Error('registeredOnly');
  return real;
}
async function scanRoot(root) {
  let count = 0;
  let unreadable = 0;
  async function walk(directory) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { unreadable++; return []; }
    const children = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory() && !IGNORED.has(entry.name)) {
        const nested = await walk(full);
        if (nested.length) children.push({ name: entry.name, path: full, children: nested });
      } else if (entry.isFile() && MARKDOWN.test(entry.name)) {
        count++;
        children.push({ name: entry.name, path: full });
      }
    }
    return children.sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name, 'en', { numeric: true }));
  }
  const children = await walk(root);
  return { path: root, name: path.basename(root) || root, children, count, error: unreadable ? { key: 'unreadableFolders', count: unreadable } : null };
}
const revisionOf = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function markdownBytes(file, roots) {
  const real = await authorizedPath(file, roots);
  if (!MARKDOWN.test(real)) throw new Error('markdownOnly');
  const info = await fs.stat(real);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('fileTooLarge');
  const bytes = await fs.readFile(real);
  return { real, info, bytes };
}
async function readMarkdown(file, roots) {
  const { bytes, info } = await markdownBytes(file, roots);
  return { content: bytes.toString('utf8').replace(/^\uFEFF/, ''), revision: revisionOf(bytes), modified: info.mtimeMs, size: info.size };
}
async function saveMarkdown(file, content, revision, roots) {
  if (typeof content !== 'string' || typeof revision !== 'string') throw new Error('invalidContent');
  const { real, info, bytes } = await markdownBytes(file, roots);
  if (revisionOf(bytes) !== revision) throw new Error('fileConflict');
  const original = bytes.toString('utf8');
  const newline = original.match(/\r\n|\r|\n/)?.[0] || '\n';
  const output = (original.startsWith('\uFEFF') ? '\uFEFF' : '') + content.replace(/\r\n?|\n/g, newline);
  if (Buffer.byteLength(output) > 20 * 1024 * 1024) throw new Error('fileTooLarge');
  const temporary = path.join(path.dirname(real), `.${path.basename(real)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, output, { flag: 'wx', mode: info.mode });
    if (await authorizedPath(file, roots) !== real || revisionOf(await fs.readFile(real)) !== revision) throw new Error('fileConflict');
    await fs.rename(temporary, real);
  } finally { await fs.rm(temporary, { force: true }); }
  return { content: output.replace(/^\uFEFF/, ''), revision: revisionOf(Buffer.from(output)) };
}
async function createMarkdown(file, roots) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('invalidPath');
  const name = path.basename(file);
  if (!MARKDOWN.test(name) || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('invalidFilename');
  const directory = await authorizedPath(path.dirname(file), roots);
  if (!(await fs.stat(directory)).isDirectory()) throw new Error('invalidFolder');
  const target = path.join(directory, name);
  try { await fs.writeFile(target, '', { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('fileExists'); throw error; }
  return target;
}
module.exports = { MARKDOWN, within, authorizedPath, scanRoot, readMarkdown, saveMarkdown, createMarkdown };
