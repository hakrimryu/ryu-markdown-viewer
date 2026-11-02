const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { MARKDOWN, within, authorizedPath, createWorkspaceIndex, readMarkdown, saveMarkdown, createMarkdown } = require('./workspace.cjs');
const messages = require('./locales.json');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }, { scheme: 'local', privileges: { standard: true, secure: true } }]);
app.setName('Ryu Markdown Viewer');
// Keep existing workspaces and preferences after the product rename.
app.setPath('userData', process.env.MARKDESK_DATA_DIR || path.join(app.getPath('appData'), 'Markdesk'));
let win;
let state = { roots: [], session: {} };
const ui = (key) => (messages[state.session.language] || messages.en)[key];
const watchers = new Map();
let changeTimer;
const changedRoots = new Set();
const index = createWorkspaceIndex(() => { if (win && !win.isDestroyed()) win.webContents.send('workspace-changed'); });
let writeQueue = Promise.resolve();
let documentQueue = Promise.resolve();
let allowClose = false;
function writeDocument(fn) {
  documentQueue = documentQueue.catch(() => {}).then(fn);
  return documentQueue;
}
const stateFile = () => path.join(app.getPath('userData'), 'workspace.json');
function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(`${stateFile()}.tmp`, snapshot);
    await fs.rename(`${stateFile()}.tmp`, stateFile());
  });
  return writeQueue;
}
function workspace(rescan = false) { return { roots: index.snapshot(state.roots, rescan), session: state.session }; }
function watchRoots() {
  for (const [root, watcher] of watchers) if (!state.roots.includes(root)) { watcher.close(); watchers.delete(root); }
  for (const root of state.roots) {
    if (watchers.has(root)) continue;
    try {
      const watcher = watch(root, { recursive: true }, (_, file) => {
        if (file && file.split(/[\\/]/).some((part) => ['.git', 'node_modules', '.svn', '.hg'].includes(part))) return;
        changedRoots.add(root);
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => { for (const changed of changedRoots) index.refresh(changed); changedRoots.clear(); }, 350);
      });
      watcher.on('error', () => { watcher.close(); watchers.delete(root); });
      watchers.set(root, watcher);
    } catch { /* The folder may be on a disconnected drive; keep it visible for reconnection. */ }
  }
}
async function addRoot(folder) {
  const real = await fs.realpath(folder);
  if (!(await fs.stat(real)).isDirectory()) throw new Error('invalidFolder');
  if (!state.roots.includes(real)) state.roots.push(real);
  index.refresh(real);
  await persist(); watchRoots();
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    const url = event.senderFrame?.url || '';
    if (event.sender !== win.webContents || !(url.startsWith('app://markdesk/') || (process.env.MARKDESK_DEV_URL && url.startsWith(`${process.env.MARKDESK_DEV_URL}/`)))) throw new Error('unauthorized');
    return fn(...args);
  });
}
function setupIPC() {
  handle('workspace', (rescan) => { watchRoots(); return workspace(rescan === true); });
  handle('add-folder', async () => {
    const result = await dialog.showOpenDialog(win, { title: ui('addFolderDialog'), buttonLabel: ui('addFolder'), properties: ['openDirectory', 'multiSelections'] });
    if (!result.canceled) for (const folder of result.filePaths) await addRoot(folder);
    return workspace();
  });
  handle('remove-folder', async (folder) => { state.roots = state.roots.filter((root) => root !== folder); await persist(); watchRoots(); return workspace(); });
  handle('open-file', async () => {
    const result = await dialog.showOpenDialog(win, { title: ui('open'), buttonLabel: ui('open'), filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }], properties: ['openFile'] });
    if (result.canceled) return null;
    const file = await fs.realpath(result.filePaths[0]);
    if (!state.roots.some((root) => within(root, file))) await addRoot(path.dirname(file));
    return file;
  });
  handle('read-file', (file) => readMarkdown(file, state.roots));
  handle('save-file', (file, content, revision) => writeDocument(() => saveMarkdown(file, content, revision, state.roots)));
  handle('create-file', async (directory) => {
    const real = await authorizedPath(directory, state.roots);
    const result = await dialog.showSaveDialog(win, { title: ui('newFile'), buttonLabel: ui('create'), defaultPath: path.join(real, 'Untitled.md'), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return null;
    return writeDocument(() => createMarkdown(result.filePath, state.roots));
  });
  handle('confirm-unsaved', async (file) => {
    const result = await dialog.showMessageBox(win, { type: 'warning', title: ui('unsaved'), message: ui('unsavedPrompt').replace('{name}', path.basename(file)), buttons: [ui('save'), ui('discard'), ui('cancel')], defaultId: 0, cancelId: 2, noLink: true });
    return ['save', 'discard', 'cancel'][result.response];
  });
  handle('resolve-link', async (from, href) => {
    const real = await authorizedPath(from, state.roots);
    if (typeof href !== 'string' || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) throw new Error('unsupportedLink');
    const target = await authorizedPath(path.resolve(path.dirname(real), decodeURIComponent(href.split(/[?#]/)[0])), state.roots);
    if (!MARKDOWN.test(target)) throw new Error('markdownLinkOnly');
    return target;
  });
  handle('save-session', async (session) => {
    if (!session || !Array.isArray(session.tabs)) return;
    state.session = { tabs: session.tabs.filter((file) => typeof file === 'string' && state.roots.some((root) => within(root, file))).slice(0, 30), active: typeof session.active === 'string' ? session.active : null, theme: session.theme === 'light' ? 'light' : 'dark', zoom: Math.min(140, Math.max(80, Number(session.zoom) || 100)), language: Object.hasOwn(messages, session.language) ? session.language : 'en' };
    await persist();
  });
  handle('open-external', async (url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url); });
  handle('window', async (action) => {
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === 'close') win.close();
    if (action === 'confirm-close') { await Promise.all([writeQueue, documentQueue.catch(() => {})]); allowClose = true; app.quit(); }
  });
}
app.whenReady().then(async () => {
  try { const saved = JSON.parse(await fs.readFile(stateFile(), 'utf8')); state.roots = Array.isArray(saved.roots) ? saved.roots.filter((root) => typeof root === 'string' && path.isAbsolute(root)) : []; state.session = saved.session || {}; } catch { /* First launch or an unreadable settings file starts a fresh workspace. */ }
  let initialFile;
  const entryIndex = process.argv.indexOf(app.getAppPath());
  const args = process.argv.slice(app.isPackaged ? 1 : entryIndex >= 1 ? entryIndex + 1 : 2);
  for (const arg of args) {
    if (!path.isAbsolute(arg)) continue;
    try { const info = await fs.stat(arg); if (info.isDirectory()) await addRoot(arg); else if (MARKDOWN.test(arg)) { await addRoot(path.dirname(arg)); initialFile = arg; } } catch {}
  }
  const dist = path.join(__dirname, '..', 'dist');
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const target = path.resolve(dist, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (url.host !== 'markdesk' || !within(dist, target)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(target).href);
  });
  protocol.handle('local', async (request) => {
    try {
      const real = await authorizedPath(new URL(request.url).searchParams.get('path'), state.roots);
      if (!/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(real) || (await fs.stat(real)).size > 30 * 1024 * 1024) return new Response('', { status: 403 });
      return net.fetch(pathToFileURL(real).href);
    } catch { return new Response('', { status: 404 }); }
  });
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 600, frame: false, backgroundColor: state.session.theme === 'dark' ? '#242424' : '#fbfaf7', title: 'Ryu Markdown Viewer', icon: path.join(__dirname, '..', 'assets', 'app-icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  setupIPC();
  win.on('close', (event) => {
    if (!allowClose) { event.preventDefault(); win.webContents.send('request-close'); }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  if (process.env.MARKDESK_DEV_URL) await win.loadURL(process.env.MARKDESK_DEV_URL); else await win.loadURL('app://markdesk/');
  if (initialFile) win.webContents.send('open-document', initialFile);
  watchRoots();
});
app.on('before-quit', (event) => {
  if (!allowClose && win && !win.isDestroyed()) { event.preventDefault(); win.webContents.send('request-close'); return; }
  clearTimeout(changeTimer);
  for (const watcher of watchers.values()) watcher.close();
});
app.on('window-all-closed', () => app.quit());
