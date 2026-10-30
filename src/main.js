import { createIcons, Files, Search, FolderPlus, FileText, ChevronRight, ChevronDown, X, Plus, Minus, Square, PanelRight, Sun, Moon, BookOpen, Code2, Copy, Check, Folder, RefreshCw, ChevronsUpDown, Maximize2, Settings, Pencil, Save, FilePlus } from 'lucide';
import mermaid from 'mermaid';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
import './style.css';
import { renderMarkdown, escapeHtml as esc } from './markdown';
import { t, languages, getLanguage, setLanguage, translateUI, welcomeDocuments } from './i18n';
import { slashMatch, matchingCommands } from './slash-commands.mjs';
import appIcon from '../assets/app-icon.png';

const api = window.markdesk;
const $ = (selector) => document.querySelector(selector);
const icon = (name, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const icons = { Files, Search, FolderPlus, FileText, ChevronRight, ChevronDown, X, Plus, Minus, Square, PanelRight, Sun, Moon, BookOpen, Code2, Copy, Check, Folder, RefreshCw, ChevronsUpDown, Maximize2, Settings, Pencil, Save, FilePlus };
const paintIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.65 } });
let roots = [];
let tabs = ['welcome'];
let active = 'welcome';
let content = welcomeDocuments.en;
let theme = 'light';
let zoom = 100;
let source = false;
let filter = '';
let renderId = 0;
let openRequest = 0;
let expanded = new Set();
let collapsedRoots = new Set();
let currentHeadings = [];
let paletteSelection = 0;
let outlineObserver;
let renderQueue = Promise.resolve();
let toastTimer;
const readingPositions = new Map();
const drafts = new Map();
let editing = false;
let saving = false;
let confirmingClose = false;
const normalize = (text) => text.replace(/\r\n?/g, '\n');
const dirty = (file) => { const draft = drafts.get(file); return !!draft && draft.text !== draft.saved; };
const directoryOf = (file) => file.replace(/[\\/][^\\/]+$/, '');
const nameOf = (file) => file === 'welcome' ? t('welcome') : file.split(/[\\/]/).at(-1);
const currentFiles = () => { const all = []; const visit = (nodes, root) => nodes.forEach((node) => node.children ? visit(node.children, root) : all.push({ ...node, root })); roots.forEach((root) => visit(root.children, root)); return all; };

$('#app').innerHTML = `
  <header class="titlebar"><div class="brand"><img src="${appIcon}" alt=""/><span>Ryu Markdown Viewer</span></div><button class="title-search" id="quick-open" data-i18n-title="quickOpen">${icon('search')}<span data-i18n="findFile"></span><kbd>Ctrl P</kbd></button><div class="window-controls"><button data-window="minimize" data-i18n-aria-label="minimize">${icon('minus')}</button><button data-window="maximize" data-i18n-aria-label="maximize">${icon('square')}</button><button data-window="close" class="window-close" data-i18n-aria-label="close">${icon('x')}</button></div></header>
  <div class="workbench"><nav class="activity" data-i18n-aria-label="activity"><button id="explorer-activity" class="active" data-i18n-title="explorerShortcut" data-i18n-aria-label="explorer">${icon('files')}</button><button id="search-activity" data-i18n-title="searchShortcut" data-i18n-aria-label="search">${icon('search')}</button><div class="activity-spacer"></div><button id="settings-button" data-i18n-title="settings" data-i18n-aria-label="settings" aria-haspopup="dialog">${icon('settings')}</button><button id="theme-toggle" data-i18n-title="theme" data-i18n-aria-label="theme">${icon('sun')}</button><button id="help-button" data-i18n-title="welcome" data-i18n-aria-label="welcome">${icon('book-open')}</button></nav>
  <aside class="sidebar"><div class="sidebar-heading"><span><span data-i18n="folders"></span> <span id="folder-badge">0</span></span><div><button id="new-file" data-i18n-title="newFileShortcut" data-i18n-aria-label="newFile">${icon('file-plus')}</button><button id="refresh" data-i18n-title="refresh" data-i18n-aria-label="refresh">${icon('refresh-cw')}</button><button id="add-folder-small" data-i18n-title="addFolder" data-i18n-aria-label="addFolder">${icon('folder-plus')}</button></div></div><label class="filter-box">${icon('search')}<input id="file-filter" data-i18n-placeholder="filter" data-i18n-aria-label="filterLabel"/><kbd>/</kbd></label><div id="tree" class="tree"></div><div class="sidebar-footer"><button id="add-folder">${icon('folder-plus')}<span data-i18n="addFolder"></span><kbd>Ctrl ⇧ O</kbd></button></div></aside>
  <main class="editor" aria-busy="false"><div class="tabs" id="tabs" role="tablist"></div><div class="document-toolbar"><div id="breadcrumbs" class="breadcrumbs"></div><div class="document-actions"><button id="edit-toggle" aria-pressed="false" data-i18n-title="edit" data-i18n-aria-label="edit">${icon('pencil')}<span data-i18n="edit"></span></button><button id="save-file" data-i18n-title="saveShortcut" data-i18n-aria-label="save">${icon('save')}</button><button id="source-toggle" aria-pressed="false">${icon('code-2')}<span id="view-label"></span></button><span class="toolbar-separator"></span><button id="zoom-out" data-i18n-title="zoomOut" data-i18n-aria-label="zoomOut">${icon('minus')}</button><button id="zoom-reset" data-i18n-title="zoomReset">100%</button><button id="zoom-in" data-i18n-title="zoomIn" data-i18n-aria-label="zoomIn">${icon('plus')}</button><span class="toolbar-separator"></span><button id="outline-toggle" data-i18n-title="outlineToggle" data-i18n-aria-label="outlineToggle">${icon('panel-right')}</button></div></div>
  <div id="document-error" class="document-error" role="alert" hidden><span id="document-error-message"></span><button id="retry-document" data-i18n="retry"></button><button id="dismiss-error" data-i18n-aria-label="errorDismiss">${icon('x')}</button></div>
  <div id="find-bar" class="find-bar" hidden>${icon('search')}<input id="find-input" data-i18n-placeholder="findText" data-i18n-aria-label="findLabel"/><span id="find-count"></span><button id="find-prev" data-i18n-title="previous" data-i18n-aria-label="previous">↑</button><button id="find-next" data-i18n-title="next" data-i18n-aria-label="next">↓</button><button id="find-close" data-i18n-title="findClose" data-i18n-aria-label="findClose">${icon('x')}</button></div>
  <div class="document-layout"><textarea id="markdown-editor" hidden spellcheck="false" data-i18n-aria-label="editMarkdown" aria-autocomplete="list" aria-controls="slash-menu" aria-expanded="false"></textarea><div class="document-scroll" id="document-scroll"><article class="markdown" id="document"></article></div><aside class="outline"><div class="outline-title" data-i18n="outline"></div><div id="outline-items"></div></aside></div>
  </main></div><footer class="statusbar"><div><span id="status-files"></span><span id="status-position" role="status" aria-live="polite" data-state="ready"></span></div><div><span id="live-label"></span><span id="status-info">UTF-8</span><span>Markdown</span></div></footer>
  <div id="slash-menu" role="listbox" data-i18n-aria-label="markdownCommands" hidden></div>
  <dialog id="palette" data-i18n-aria-label="paletteLabel"><div class="palette-input">${icon('search')}<input id="palette-query" data-i18n-placeholder="palettePlaceholder" data-i18n-aria-label="paletteLabel"/><kbd>Esc</kbd></div><div class="palette-label" data-i18n="markdownFiles"></div><div id="palette-results"></div><div class="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> <span data-i18n="navigate"></span></span><span><kbd>↵</kbd> <span data-i18n="open"></span></span></div></dialog>
  <dialog id="settings-dialog" aria-labelledby="settings-title"><div class="settings-header"><h2 id="settings-title" data-i18n="settings"></h2><button id="settings-close" data-i18n-title="close" data-i18n-aria-label="close">${icon('x')}</button></div><section class="settings-content" aria-labelledby="settings-general"><h3 id="settings-general" data-i18n="general"></h3><div class="setting-row"><div><label for="language-select" data-i18n="language"></label><p id="language-description" data-i18n="languageDescription"></p></div><select id="language-select" aria-describedby="language-description language-saved">${Object.entries(languages).map(([code, name]) => `<option value="${code}" lang="${code}">${name}</option>`).join('')}</select></div><p id="language-saved" class="settings-hint" data-i18n="languageSaved"></p></section></dialog>
  <dialog id="graph-viewer" data-i18n-aria-label="graph"><div class="graph-header"><span data-i18n="graphTitle"></span><div><button id="graph-minus" data-i18n-title="zoomOut" data-i18n-aria-label="zoomOut">${icon('minus')}</button><button id="graph-scale" data-i18n-title="originalSize">100%</button><button id="graph-plus" data-i18n-title="zoomIn" data-i18n-aria-label="zoomIn">${icon('plus')}</button><span class="toolbar-separator"></span><button id="graph-close" data-i18n-title="close" data-i18n-aria-label="close">${icon('x')}</button></div></div><div class="graph-stage"><div class="graph-sheet"></div></div></dialog><div id="toast" role="status" hidden></div>`;
translateUI();
paintIcons();
window.addEventListener('resize', () => $('#tabs [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));

function toast(message) { const el = $('#toast'); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4500); }
async function attempt(fn) { try { return await fn(); } catch (error) { toast(t(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''))); } }
function setStatus(text, busy = false, error = false) { $('#status-position').textContent = text; $('#status-position').dataset.state = error ? 'error' : busy ? 'loading' : 'ready'; $('.editor').setAttribute('aria-busy', String(busy)); }
function persist() { return api?.saveSession({ tabs: tabs.filter((file) => file !== 'welcome'), active, theme, zoom, language: getLanguage() }).catch((error) => toast(t('saveError', { message: error.message }))); }
function renderTree() {
  $('#folder-badge').textContent = roots.length;
  $('#status-files').textContent = t('folderCount', { folders: roots.length, files: roots.reduce((sum, root) => sum + root.count, 0) });
  const matches = (node) => node.children ? node.children.some(matches) : node.name.toLowerCase().includes(filter.toLowerCase());
  function nodes(list, depth) {
    return list.filter(matches).map((node) => {
      const folder = !!node.children;
      const open = filter || expanded.has(node.path);
      return `<button class="tree-node ${active === node.path ? 'selected' : ''} ${folder ? 'tree-folder' : ''}" style="--depth:${depth}" data-${folder ? 'folder' : 'file'}="${esc(node.path)}" title="${esc(node.path)}" ${folder ? `aria-expanded="${!!open}"` : ''}>${folder ? icon(open ? 'chevron-down' : 'chevron-right', 'tree-chevron') + icon('folder', 'folder-icon') : '<span class="tree-indent"></span>' + icon('file-text', 'md-icon')}<span>${esc(node.name)}</span></button>${folder && open ? nodes(node.children, depth + 1) : ''}`;
    }).join('');
  }
  $('#tree').innerHTML = roots.length ? roots.map((root) => `<section class="root-group"><div class="root-row"><button data-root="${esc(root.path)}" aria-expanded="${!collapsedRoots.has(root.path)}" title="${esc(root.path)}">${icon(collapsedRoots.has(root.path) ? 'chevron-right' : 'chevron-down')}${icon('folder', 'root-folder')}<span>${esc(root.name)}</span><small>${root.count}</small></button><button class="create-in-folder" data-create="${esc(root.path)}" title="${t('newFile')}" aria-label="${t('newFile')}">${icon('file-plus')}</button><button class="remove-root" data-remove="${esc(root.path)}" title="${t('removeFolderTitle')}" aria-label="${t('removeFolder')}">${icon('x')}</button></div>${!collapsedRoots.has(root.path) ? `${root.error ? `<div class="tree-notice" role="alert">${esc(t(root.error.key, { count: root.error.count }))}</div>` : ''}${nodes(root.children, 0) || `<div class="tree-notice">${filter ? t('noMatches') : t('noMarkdown')}</div>`}` : ''}</section>`).join('') : `<div class="empty-tree"><strong>${t('noFolders')}</strong><p>${t('addFolderHint')}</p><button id="empty-add">${t('chooseFolder')}</button></div>`;
  paintIcons();
}
function renderTabs() {
  $('#tabs').innerHTML = tabs.map((file) => `<div role="tab" tabindex="${active === file ? 0 : -1}" aria-selected="${active === file}" class="tab ${active === file ? 'active' : ''}" data-tab="${esc(file)}" title="${esc(file === 'welcome' ? t('welcome') : file)}">${icon(file === 'welcome' ? 'book-open' : 'file-text', 'md-icon')}<span>${esc(nameOf(file))}${dirty(file) ? ' •' : ''}</span><button data-close="${esc(file)}" title="${t('closeTab')}" aria-label="${esc(t('closeNamedTab', { name: nameOf(file) }))}">${icon('x')}</button></div>`).join('') + `<button id="tab-open" class="tab-plus" title="${t('openFileTitle')}" aria-label="${t('openFileTitle')}">${icon('plus')}</button><span class="tabs-fill"></span><span class="tabs-readonly">${active === 'welcome' ? t('readOnly') : dirty(active) ? t('unsaved') : t('saved')}</span>`;
  const root = roots.filter((root) => active.startsWith(root.path + '\\') || active.startsWith(root.path + '/')).sort((a, b) => b.path.length - a.path.length)[0];
  const parts = active === 'welcome' ? ['Ryu Markdown Viewer', t('welcome')] : [root?.name || '', ...active.slice((root?.path.length || 0) + 1).split(/[\\/]/)].filter(Boolean);
  $('#breadcrumbs').innerHTML = parts.map((part, i) => `${i ? icon('chevron-right') : ''}<span class="${i === parts.length - 1 ? 'current' : ''}">${esc(part)}</span>`).join('');
  $('#breadcrumbs').title = active === 'welcome' ? t('welcome') : active;
  document.title = `${nameOf(active)} — Ryu Markdown Viewer`;
  paintIcons();
  $('#tabs [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function localImage(src) {
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  if (active === 'welcome' || /^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('//')) return '';
  try {
    const dir = active.replace(/[^\\/]+$/, '').replaceAll('\\', '/');
    const url = new URL(src, `file:///${dir}`);
    return `local://asset/?path=${encodeURIComponent(decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, '$1'))}`;
  } catch { return ''; }
}
function readingBlocks() {
  return [...$('#document').querySelectorAll('[data-source-start]')].map((element) => ({
    element, start: Number(element.dataset.sourceStart), end: Number(element.dataset.sourceEnd), rect: element.getBoundingClientRect()
  })).filter((block) => block.rect.height > 0 && block.end > block.start);
}
function captureReadingPosition() {
  const scroll = $('#document-scroll');
  if (scroll.scrollTop === 0) return { line: 0, top: true };
  if (scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 2) return { bottom: true };
  const y = scroll.getBoundingClientRect().top + 24;
  const blocks = readingBlocks();
  const block = blocks.filter((item) => item.rect.top <= y && item.rect.bottom > y)
    .sort((a, b) => b.rect.top - a.rect.top || a.rect.height - b.rect.height)[0]
    || blocks.find((item) => item.rect.bottom > y) || blocks.at(-1);
  if (!block) return { line: 0, top: true };
  const fraction = Math.max(0, Math.min(.999, (y - block.rect.top) / block.rect.height));
  return { line: block.start + fraction * (block.end - block.start), top: false };
}
function restoreReadingPosition(position) {
  const scroll = $('#document-scroll');
  if (position.top) { scroll.scrollTop = 0; return; }
  if (position.bottom) { scroll.scrollTop = scroll.scrollHeight; return; }
  const blocks = readingBlocks();
  const block = blocks.filter((item) => item.start <= position.line && item.end > position.line)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]
    || blocks.find((item) => item.start >= position.line) || blocks.at(-1);
  if (!block) return;
  const fraction = Math.max(0, Math.min(1, (position.line - block.start) / (block.end - block.start)));
  scroll.scrollTop += block.rect.top + fraction * block.rect.height - scroll.getBoundingClientRect().top - 24;
}
async function renderDocument(resetScroll = true, position = null) {
  const version = ++renderId;
  outlineObserver?.disconnect();
  const doc = $('#document');
  doc.style.setProperty('--doc-zoom', zoom / 100);
  const isEditing = editing && active !== 'welcome';
  $('.document-layout').classList.toggle('is-editing', isEditing);
  $('#markdown-editor').hidden = !isEditing;
  $('#document-scroll').hidden = isEditing;
  $('#edit-toggle').disabled = active === 'welcome';
  $('#edit-toggle').classList.toggle('pressed', isEditing);
  $('#edit-toggle').setAttribute('aria-pressed', String(isEditing));
  $('#save-file').disabled = !dirty(active) || saving;
  if (isEditing) {
    const draft = drafts.get(active);
    if ($('#markdown-editor').value !== draft.text) $('#markdown-editor').value = draft.text;
    $('#markdown-editor').style.setProperty('--doc-zoom', zoom / 100);
    $('#markdown-editor').setSelectionRange(draft.selectionStart ?? 0, draft.selectionEnd ?? 0);
    $('#markdown-editor').scrollTop = draft.scrollTop || 0;
    $('#status-info').textContent = t('lineCount', { count: draft.text.split('\n').length });
    $('#zoom-reset').textContent = `${zoom}%`;
    paintIcons();
    return;
  }
  doc.innerHTML = source ? `<pre class="source-view"><code>${content.replace(/\r\n?/g, '\n').split('\n').map((line, index) => `<span class="source-line" data-source-start="${index}" data-source-end="${index + 1}">${esc(line)}</span>`).join('')}</code></pre>` : renderMarkdown(content);
  $('#source-toggle').classList.toggle('pressed', source);
  $('#source-toggle').setAttribute('aria-pressed', String(source));
  $('#source-toggle').title = source ? t('preview') : t('sourceTitle');
  $('#source-toggle').setAttribute('aria-label', source ? t('preview') : t('sourceTitle'));
  $('#view-label').textContent = source ? t('preview') : t('source');
  $('#live-label').textContent = active === 'welcome' ? t('readOnly') : t('live');
  $('#zoom-reset').textContent = `${zoom}%`;
  $('#status-info').textContent = t('lineCount', { count: content.split('\n').length });
  if (resetScroll) $('#document-scroll').scrollTop = 0;
  currentHeadings = [];
  if (!source && !isEditing) {
    doc.querySelectorAll('img').forEach((img) => { img.setAttribute('src', localImage(img.getAttribute('src') || '')); img.loading = 'lazy'; img.addEventListener('error', () => { img.classList.add('broken-image'); img.title = t('imageError'); }); });
    const used = new Set();
    doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((heading, i) => {
      const slug = heading.textContent.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || `section-${i}`;
      let id = slug; let suffix = 1; while (used.has(id)) id = `${slug}-${suffix++}`;
      used.add(id); heading.id = id;
      currentHeadings.push({ id, text: heading.textContent, level: Number(heading.tagName[1]) });
    });
    doc.querySelectorAll('.code-block').forEach((block) => {
      const button = document.createElement('button'); button.className = 'copy-code'; button.title = t('copyCode'); button.setAttribute('aria-label', t('copyCode')); button.innerHTML = icon('copy');
      button.onclick = () => attempt(async () => { await navigator.clipboard.writeText(block.querySelector('code').textContent); button.innerHTML = icon('check'); paintIcons(); setTimeout(() => { if (button.isConnected) { button.innerHTML = icon('copy'); paintIcons(); } }, 1500); });
      block.append(button);
    });
  }
  $('#outline-items').innerHTML = currentHeadings.filter((h) => h.level > 1).map((heading) => `<button data-heading="${esc(heading.id)}" style="--level:${heading.level}">${esc(heading.text)}</button>`).join('') || `<p class="outline-empty">${t('noHeadings')}</p>`;
  if (currentHeadings.length) {
    outlineObserver = new IntersectionObserver((entries) => { const visible = entries.find((entry) => entry.isIntersecting); if (visible) { $('#outline-items').querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.heading === visible.target.id)); } }, { root: $('#document-scroll'), rootMargin: '-10% 0px -65% 0px' });
    doc.querySelectorAll('h2,h3,h4').forEach((heading) => outlineObserver.observe(heading));
  }
  paintIcons();
  if (position && !isEditing) restoreReadingPosition(position);
  const diagrams = [...doc.querySelectorAll('[data-diagram]')].map((element) => ({ element, text: element.textContent }));
  renderQueue = renderQueue.catch(() => {}).then(async () => {
    if (version !== renderId) return;
    await document.fonts.load('400 15px SUIT');
    if (version !== renderId) return;
    const dark = theme === 'dark';
    mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'strict', suppressErrorRendering: true, fontFamily: 'SUIT, Segoe UI, Malgun Gothic, sans-serif', themeCSS: '.node rect, .node polygon, .node path, .node circle, .node ellipse { filter: none !important; }', flowchart: { htmlLabels: false }, themeVariables: { darkMode: dark, background: dark ? '#242424' : '#fbfaf7', primaryColor: dark ? '#323230' : '#eeede7', primaryTextColor: dark ? '#deddd8' : '#30312d', primaryBorderColor: dark ? '#8b8b80' : '#92938a', secondaryColor: dark ? '#3d3b34' : '#e7e3d9', tertiaryColor: dark ? '#292a27' : '#f4f3ed', lineColor: dark ? '#a5a59b' : '#74776d', textColor: dark ? '#deddd8' : '#30312d', actorTextColor: dark ? '#deddd8' : '#30312d', actorBorder: dark ? '#8b8b80' : '#92938a', actorBkg: dark ? '#323230' : '#eeede7', signalColor: dark ? '#deddd8' : '#30312d', pie1: '#b5b3a4', pie2: '#d9d3bf', pie3: '#8d9685', pieStrokeColor: dark ? '#242424' : '#fbfaf7' } });
    for (let i = 0; i < diagrams.length; i++) {
      if (version !== renderId) return;
      const { element, text } = diagrams[i];
      try {
        const { svg } = await mermaid.render(`diagram-${version}-${i}`, text);
        if (version === renderId && element.isConnected) {
          element.innerHTML = `<div class="diagram-label">Mermaid</div><div class="diagram-canvas">${svg}</div>`;
          const button = document.createElement('button'); button.className = 'diagram-expand'; button.title = t('graph'); button.setAttribute('aria-label', button.title); button.innerHTML = icon('maximize-2');
          button.onclick = () => showGraph(element.querySelector('.diagram-canvas svg'));
          element.append(button);
        }
      } catch (error) {
        if (version === renderId && element.isConnected) element.innerHTML = `<div class="diagram-error"><strong>${t('diagramError')}</strong><details><summary>${t('errorDetails')}</summary><pre>${esc(error.message || String(error))}</pre></details></div><pre>${esc(text)}</pre>`;
      }
    }
    paintIcons();
  });
  await renderQueue;
  if (version !== renderId) return;
  if (position && !isEditing) restoreReadingPosition(position);
  if (!$('#find-bar').hidden) findText(resetScroll && !position);
}
let retryFile; let retryError;
function showDocumentError(file, detail) {
  const message = /ENOENT|ENOTDIR/.test(detail) ? t('fileMissing') : /EACCES|EPERM/.test(detail) ? t('fileDenied') : t(detail);
  $('#document-error-message').textContent = `${nameOf(file)} · ${message}`;
  $('#document-error').hidden = false;
  setStatus(t('openError'), false, true);
}
async function openDocument(file, reset = true) {
  const request = ++openRequest;
  $('#markdown-editor').readOnly = true;
  setStatus(t('opening'), true);
  let result;
  try { result = file === 'welcome' ? { content: welcomeDocuments[getLanguage()] } : dirty(file) ? { content: drafts.get(file).text } : await api.readFile(file); }
  catch (error) {
    if (request === openRequest) {
      $('#markdown-editor').readOnly = false;
      retryFile = file;
      const detail = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
      retryError = detail;
      showDocumentError(file, detail);
    }
    return;
  }
  if (request !== openRequest) return;
  rememberEditor(); hideSlash(); slashDismissed = null;
  const position = file === active ? captureReadingPosition() : readingPositions.get(file);
  if (file !== active) readingPositions.set(active, captureReadingPosition());
  $('#document-error').hidden = true;
  if (!tabs.includes(file)) tabs.push(file);
  active = file; content = result.content;
  if (file !== 'welcome' && !dirty(file)) drafts.set(file, { text: normalize(content), saved: normalize(content), revision: result.revision });
  if (file !== 'welcome') { let parent = file.replace(/[\\/][^\\/]+$/, ''); while (parent && parent !== parent.replace(/[\\/][^\\/]+$/, '')) { expanded.add(parent); parent = parent.replace(/[\\/][^\\/]+$/, ''); } }
  renderTabs(); renderTree(); persist();
  await renderDocument(position ? false : reset, position);
  if (request === openRequest) { $('#markdown-editor').readOnly = false; setStatus(t('ready')); }
}
$('#retry-document').onclick = () => attempt(() => openDocument(retryFile));
$('#dismiss-error').onclick = () => { $('#document-error').hidden = true; setStatus(t('ready')); };
async function reloadWorkspace(refreshDocument = false) {
  if (!api) return;
  const workspace = await api.workspace(); roots = workspace.roots;
  renderTree();
  if (refreshDocument && active !== 'welcome' && !editing && !dirty(active)) await attempt(() => openDocument(active, false));
}
function rememberEditor() {
  const draft = drafts.get(active);
  if (!editing || !draft) return;
  const editor = $('#markdown-editor');
  draft.selectionStart = editor.selectionStart; draft.selectionEnd = editor.selectionEnd; draft.scrollTop = editor.scrollTop;
}
async function saveFile(file = active) {
  if (!dirty(file)) return true;
  if (saving) return false;
  const draft = drafts.get(file);
  const text = draft.text;
  saving = true; $('#save-file').disabled = true;
  try {
    const result = await api.saveFile(file, text, draft.revision);
    draft.saved = normalize(result.content); draft.revision = result.revision;
    if (active === file) content = draft.text;
    renderTabs(); toast(t('fileSaved'));
    return true;
  } catch (error) {
    toast(t(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')));
    return false;
  } finally { saving = false; $('#save-file').disabled = !dirty(active); }
}
async function confirmDraft(file) {
  if (!dirty(file)) return true;
  const choice = await api.confirmUnsaved(file);
  return choice === 'save' ? saveFile(file) : choice === 'discard';
}
async function newFile(directory = active === 'welcome' ? roots[0]?.path : directoryOf(active)) {
  if (!api) return toast(t('fileAppOnly'));
  if (!directory) return toast(t('addFolderFirst'));
  const file = await api.createFile(directory);
  if (!file) return;
  filter = ''; $('#file-filter').value = '';
  for (const root of roots) collapsedRoots.delete(root.path);
  await reloadWorkspace();
  editing = true;
  await openDocument(file);
  $('#markdown-editor').focus();
}
api?.onBeforeClose(async () => {
  if (confirmingClose) return;
  confirmingClose = true;
  try {
    for (const file of tabs) if (!await confirmDraft(file)) return;
    await api.window('confirm-close');
  } catch (error) { toast(error.message); }
  finally { confirmingClose = false; }
});

let slashContext = null;
let slashItems = [];
let slashSelection = 0;
let slashDismissed = null;
function hideSlash() {
  $('#slash-menu').hidden = true;
  $('#markdown-editor').setAttribute('aria-expanded', 'false');
  $('#markdown-editor').removeAttribute('aria-activedescendant');
}
function positionSlash() {
  const editor = $('#markdown-editor');
  const style = getComputedStyle(editor);
  const mirror = document.createElement('div');
  for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'border', 'boxSizing', 'tabSize']) mirror.style[key] = style[key];
  Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: `${editor.clientWidth}px` });
  mirror.textContent = editor.value.slice(0, editor.selectionStart);
  const caret = document.createElement('span'); caret.textContent = '\u200b'; mirror.append(caret); document.body.append(mirror);
  const rect = editor.getBoundingClientRect();
  const x = rect.left + caret.offsetLeft - editor.scrollLeft;
  const y = rect.top + caret.offsetTop - editor.scrollTop;
  mirror.remove();
  const menu = $('#slash-menu');
  menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, x))}px`;
  const below = y + parseFloat(style.lineHeight) + 4;
  menu.style.top = `${Math.max(rect.top, below + menu.offsetHeight < innerHeight - 32 ? below : y - menu.offsetHeight - 4)}px`;
}
function updateSlash(reset = false) {
  const editor = $('#markdown-editor');
  const context = slashMatch(editor.value, editor.selectionStart);
  if (!editing || editor.selectionStart !== editor.selectionEnd || !context || slashDismissed === context.start) return hideSlash();
  if (reset || context.start !== slashContext?.start || context.query !== slashContext?.query) slashSelection = 0;
  slashContext = context;
  slashItems = matchingCommands(context.query, t);
  if (!slashItems.length) return hideSlash();
  slashSelection = Math.min(slashSelection, slashItems.length - 1);
  $('#slash-menu').innerHTML = `<div class="slash-hint">${t('slashHint')}</div>` + slashItems.map((command, index) => `<button type="button" role="option" id="slash-option-${index}" data-command="${index}" aria-selected="${index === slashSelection}" class="${index === slashSelection ? 'selected' : ''}"><span>${esc(t(command.label))}</span><code>/${command.id}</code></button>`).join('');
  $('#slash-menu').hidden = false;
  editor.setAttribute('aria-expanded', 'true');
  editor.setAttribute('aria-activedescendant', `slash-option-${slashSelection}`);
  $('#slash-menu [aria-selected="true"]').scrollIntoView({ block: 'nearest' });
  positionSlash();
}
function insertCommand(index) {
  const command = slashItems[index];
  if (!command || !slashContext) return;
  const editor = $('#markdown-editor');
  const start = slashContext.start;
  editor.focus(); editor.setSelectionRange(start, editor.selectionStart);
  // Chromium's editing command keeps snippet insertion in the native undo history.
  if (!document.execCommand('insertText', false, command.text)) editor.setRangeText(command.text, editor.selectionStart, editor.selectionEnd, 'end');
  const caret = start + (command.caret ?? command.text.length);
  editor.setSelectionRange(caret, caret);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  hideSlash();
}
$('#markdown-editor').oninput = (event) => {
  const draft = drafts.get(active);
  if (!draft) return;
  draft.text = event.target.value; content = draft.text; rememberEditor();
  $('#save-file').disabled = !dirty(active) || saving;
  $('#status-info').textContent = t('lineCount', { count: content.split('\n').length });
  renderTabs();
  if (!slashMatch(event.target.value, event.target.selectionStart)) slashDismissed = null;
  if (!event.isComposing) updateSlash(true);
};
$('#markdown-editor').onkeydown = (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (!$('#slash-menu').hidden) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); slashSelection = (slashSelection + (event.key === 'ArrowDown' ? 1 : slashItems.length - 1)) % slashItems.length; updateSlash(); return; }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); insertCommand(slashSelection); return; }
    if (event.key === 'Escape') { event.preventDefault(); slashDismissed = slashContext.start; hideSlash(); }
  }
};
$('#markdown-editor').onkeyup = (event) => { if (!event.isComposing && !['Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown'].includes(event.key)) updateSlash(); };
$('#markdown-editor').oncompositionstart = hideSlash;
$('#markdown-editor').oncompositionend = () => updateSlash(true);
$('#markdown-editor').onclick = () => { rememberEditor(); updateSlash(); };
$('#markdown-editor').onscroll = () => { rememberEditor(); if (!$('#slash-menu').hidden) positionSlash(); };
$('#markdown-editor').onblur = () => { rememberEditor(); hideSlash(); };
$('#slash-menu').onmousedown = (event) => { event.preventDefault(); const button = event.target.closest('[data-command]'); if (button) insertCommand(Number(button.dataset.command)); };
window.addEventListener('resize', () => { if (!$('#slash-menu').hidden) positionSlash(); });
async function addFolder() { if (!api) return toast(t('folderAppOnly')); const data = await api.addFolder(); roots = data.roots; renderTree(); }
async function pickFile() { if (!api) return toast(t('fileAppOnly')); const file = await api.openFile(); if (file) { await reloadWorkspace(); await openDocument(file); } }
async function closeTab(file) { if (!await confirmDraft(file)) return; drafts.delete(file); const index = tabs.indexOf(file); tabs = tabs.filter((tab) => tab !== file); if (!tabs.length) tabs = ['welcome']; if (active === file) await openDocument(tabs[Math.min(index, tabs.length - 1)]); else { renderTabs(); persist(); } readingPositions.delete(file); }

$('#tree').onclick = (event) => attempt(async () => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.id === 'empty-add') return addFolder();
  if (button.dataset.create) return newFile(button.dataset.create);
  if (button.dataset.file) return openDocument(button.dataset.file);
  if (button.dataset.folder) { expanded.has(button.dataset.folder) ? expanded.delete(button.dataset.folder) : expanded.add(button.dataset.folder); renderTree(); }
  if (button.dataset.root) { collapsedRoots.has(button.dataset.root) ? collapsedRoots.delete(button.dataset.root) : collapsedRoots.add(button.dataset.root); renderTree(); }
  if (button.dataset.remove) {
    const removed = button.dataset.remove;
    for (const file of tabs) { if (file.startsWith(removed + '\\') || file.startsWith(removed + '/')) { if (!await confirmDraft(file)) return; } }
    const result = await api.removeFolder(removed); roots = result.roots;
    const keep = new Set(currentFiles().map((file) => file.path));
    tabs = tabs.filter((file) => file === 'welcome' || keep.has(file));
    if (!tabs.includes(active)) await openDocument(tabs[0] || 'welcome');
    for (const file of drafts.keys()) if (!tabs.includes(file)) drafts.delete(file);
    for (const file of readingPositions.keys()) if (!tabs.includes(file)) readingPositions.delete(file);
    renderTree(); renderTabs(); persist(); toast(t('folderRemoved'));
  }
});
$('#tabs').onclick = (event) => attempt(async () => { const close = event.target.closest('[data-close]'); if (close) return closeTab(close.dataset.close); const tab = event.target.closest('[data-tab]'); if (tab) return openDocument(tab.dataset.tab); if (event.target.closest('#tab-open')) return pickFile(); });
$('#tabs').onkeydown = (event) => { const tab = event.target.closest('[data-tab]'); if (!tab) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); attempt(() => openDocument(tab.dataset.tab)); } if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { const next = tabs[(tabs.indexOf(active) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; attempt(async () => { await openDocument(next); [...$('#tabs').querySelectorAll('[data-tab]')].find((el) => el.dataset.tab === next)?.focus(); }); } };
$('#file-filter').oninput = (event) => { filter = event.target.value; renderTree(); };
$('#add-folder').onclick = $('#add-folder-small').onclick = () => attempt(addFolder);
$('#refresh').onclick = () => attempt(async () => { await reloadWorkspace(true); toast(t('refreshed')); });
$('#help-button').onclick = () => attempt(() => openDocument('welcome'));
const toggleSidebar = () => $('.workbench').classList.toggle('hide-sidebar');
$('#explorer-activity').onclick = toggleSidebar;
$('#outline-toggle').onclick = () => $('.document-layout').classList.toggle('hide-outline');
$('#source-toggle').onclick = () => { if (editing && active !== 'welcome') { rememberEditor(); editing = false; hideSlash(); } const position = captureReadingPosition(); source = !source; attempt(() => renderDocument(false, position)); };
function setZoom(value) { zoom = Math.max(80, Math.min(140, value)); $('#document').style.setProperty('--doc-zoom', zoom / 100); $('#markdown-editor').style.setProperty('--doc-zoom', zoom / 100); $('#zoom-reset').textContent = `${zoom}%`; persist(); }
$('#new-file').onclick = () => attempt(() => newFile());
$('#edit-toggle').onclick = () => attempt(async () => { rememberEditor(); editing = !editing; hideSlash(); await renderDocument(false); if (editing && active !== 'welcome') $('#markdown-editor').focus(); });
$('#save-file').onclick = () => attempt(() => saveFile());
$('#zoom-in').onclick = () => setZoom(zoom + 10); $('#zoom-out').onclick = () => setZoom(zoom - 10); $('#zoom-reset').onclick = () => setZoom(100);
$('#theme-toggle').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; $('#theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon'); persist(); renderDocument(false); };

$('#settings-button').onclick = () => { $('#settings-dialog').showModal(); $('#language-select').focus(); };
$('#settings-close').onclick = () => $('#settings-dialog').close();
$('#settings-dialog').onclick = (event) => { if (event.target === $('#settings-dialog')) $('#settings-dialog').close(); };
$('#language-select').onchange = () => attempt(async () => {
  const position = captureReadingPosition();
  setLanguage($('#language-select').value);
  translateUI();
  renderTree(); renderTabs(); renderPalette();
  if (active === 'welcome') content = welcomeDocuments[getLanguage()];
  await persist();
  await renderDocument(false, active === 'welcome' ? null : position);
  if (!$('#document-error').hidden) showDocumentError(retryFile, retryError);
  else setStatus(t('ready'));
});
document.querySelectorAll('[data-window]').forEach((button) => { button.onclick = () => api?.window(button.dataset.window); });
$('.titlebar').ondblclick = (event) => { if (!event.target.closest('button')) api?.window('maximize'); };
$('#outline-items').onclick = (event) => { const button = event.target.closest('[data-heading]'); if (button) document.getElementById(button.dataset.heading)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
let graphScale = 1; let graphWidth = 800;
function setGraphScale(value) { graphScale = Math.max(.25, Math.min(3, value)); $('.graph-sheet').style.width = `${graphWidth * graphScale}px`; $('#graph-scale').textContent = `${Math.round(graphScale * 100)}%`; }
function showGraph(svg) { if (!svg) return; const clone = svg.cloneNode(true); $('.graph-sheet').replaceChildren(clone); graphWidth = svg.viewBox.baseVal.width || 800; setGraphScale(1); $('#graph-viewer').showModal(); }
$('#graph-minus').onclick = () => setGraphScale(graphScale - .25); $('#graph-plus').onclick = () => setGraphScale(graphScale + .25); $('#graph-scale').onclick = () => setGraphScale(1); $('#graph-close').onclick = () => $('#graph-viewer').close();
$('#graph-viewer').onclick = (event) => { if (event.target === $('#graph-viewer')) $('#graph-viewer').close(); };
$('#document').onclick = (event) => attempt(async () => {
  const link = event.target.closest('a'); if (!link) return;
  event.preventDefault(); const href = link.getAttribute('href') || '';
  if (href.startsWith('#')) { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' }); return; }
  if (/^https?:\/\//i.test(href)) return api?.openExternal(href);
  if (active === 'welcome' || !api) return;
  const file = await api.resolveLink(active, href); await openDocument(file);
  if (href.includes('#')) document.getElementById(decodeURIComponent(href.split('#')[1]))?.scrollIntoView();
});

function paletteResults() { const query = $('#palette-query').value.trim().toLowerCase(); return currentFiles().filter((file) => `${file.name} ${file.path}`.toLowerCase().includes(query)).slice(0, 80); }
function renderPalette() {
  const files = paletteResults(); paletteSelection = Math.min(paletteSelection, Math.max(0, files.length - 1));
  $('#palette-results').innerHTML = files.length ? files.map((file, index) => `<button data-palette-file="${esc(file.path)}" class="palette-result ${index === paletteSelection ? 'selected' : ''}">${icon('file-text', 'md-icon')}<span><strong>${esc(file.name)}</strong><small>${esc(file.path)}</small></span>${index === paletteSelection ? '<kbd>↵</kbd>' : ''}</button>`).join('') : `<div class="palette-empty">${roots.length ? t('noMatchingMarkdown') : t('addFolderFirst')}</div>`;
  paintIcons(); $('#palette-results .selected')?.scrollIntoView({ block: 'nearest' });
}
function openPalette() { $('#palette-query').value = ''; paletteSelection = 0; renderPalette(); if (!$('#palette').open) $('#palette').showModal(); $('#palette-query').focus(); }
$('#quick-open').onclick = $('#search-activity').onclick = openPalette;
$('#palette-query').oninput = () => { paletteSelection = 0; renderPalette(); };
$('#palette').onclick = (event) => { const button = event.target.closest('[data-palette-file]'); if (button) { $('#palette').close(); attempt(() => openDocument(button.dataset.paletteFile)); } if (event.target === $('#palette')) $('#palette').close(); };
$('#palette-query').onkeydown = (event) => { const files = paletteResults(); if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); paletteSelection = Math.max(0, Math.min(files.length - 1, paletteSelection + (event.key === 'ArrowDown' ? 1 : -1))); renderPalette(); } if (event.key === 'Enter' && files[paletteSelection]) { $('#palette').close(); attempt(() => openDocument(files[paletteSelection].path)); } };

let findMatches = []; let findIndex = -1;
function clearMatches() { $('#document').querySelectorAll('mark.search-hit').forEach((mark) => mark.replaceWith(document.createTextNode(mark.textContent))); $('#document').normalize(); }
function findText(scrollToMatch = true) {
  clearMatches(); findMatches = []; findIndex = -1;
  const query = $('#find-input').value.toLowerCase();
  if (query) {
    const walker = document.createTreeWalker($('#document'), NodeFilter.SHOW_TEXT, { acceptNode: (node) => node.parentElement.closest('svg, .katex, button, .diagram') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.textContent; const lower = text.toLowerCase(); let start = 0; let index = lower.indexOf(query); if (index < 0) continue;
      const fragment = document.createDocumentFragment();
      while (index >= 0) { fragment.append(text.slice(start, index)); const mark = document.createElement('mark'); mark.className = 'search-hit'; mark.textContent = text.slice(index, index + query.length); fragment.append(mark); findMatches.push(mark); start = index + query.length; index = lower.indexOf(query, start); }
      fragment.append(text.slice(start)); node.replaceWith(fragment);
    }
  }
  advanceFind(1, scrollToMatch);
}
function advanceFind(direction, scrollToMatch = true) { if (findMatches.length) { findIndex = (findIndex + direction + findMatches.length) % findMatches.length; findMatches.forEach((mark, index) => mark.classList.toggle('current-hit', index === findIndex)); if (scrollToMatch) findMatches[findIndex].scrollIntoView({ block: 'center' }); } $('#find-count').textContent = `${findMatches.length ? findIndex + 1 : 0} / ${findMatches.length}`; }
function closeFind() { $('#find-bar').hidden = true; clearMatches(); }
$('#find-input').oninput = () => findText(); $('#find-next').onclick = () => advanceFind(1); $('#find-prev').onclick = () => advanceFind(-1); $('#find-close').onclick = closeFind;
$('#find-input').onkeydown = (event) => { if (event.key === 'Enter') advanceFind(event.shiftKey ? -1 : 1); if (event.key === 'Escape') closeFind(); };
document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]')) return;
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase();
    if (['o', 'n', 's', 'p', 'f', 'b', 'w', '+', '=', '-', '0'].includes(key)) event.preventDefault();
    if (key === 'n') attempt(() => newFile());
    if (key === 's') attempt(() => saveFile());
    if (key === 'o') attempt(event.shiftKey ? addFolder : pickFile);
    if (key === 'p') openPalette();
    if (key === 'f') { if (editing && active !== 'welcome') { rememberEditor(); editing = false; hideSlash(); renderDocument(false); } $('#find-bar').hidden = false; $('#find-input').focus(); $('#find-input').select(); }
    if (key === 'b') toggleSidebar();
    if (key === 'w') attempt(() => closeTab(active));
    if (key === '+' || key === '=') setZoom(zoom + 10);
    if (key === '-') setZoom(zoom - 10);
    if (key === '0') setZoom(100);
  } else if (event.key === '/' && !event.target.closest('input, textarea, dialog')) { event.preventDefault(); $('#file-filter').focus(); }
});
api?.onChange(() => attempt(() => reloadWorkspace(true)));
api?.onOpen((file) => attempt(() => openDocument(file)));
async function init() {
  if (api) {
    const data = await api.workspace(); roots = data.roots;
    const session = data.session || {}; theme = session.theme || 'light'; zoom = session.zoom || 100;
    setLanguage(session.language);
    document.documentElement.dataset.theme = theme;
    $('#theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    const files = new Set(currentFiles().map((file) => file.path));
    tabs = (session.tabs || []).filter((file) => files.has(file));
    if (!tabs.length) tabs = ['welcome'];
    active = tabs.includes(session.active) ? session.active : tabs[0];
  }
  translateUI();
  $('#language-select').value = getLanguage();
  await openDocument(active);
}
attempt(init);
