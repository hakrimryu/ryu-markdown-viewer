import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const cwd = process.cwd();
const base = path.join(cwd, '.test-data');
await fs.mkdir(base, { recursive: true });
const run = await fs.mkdtemp(path.join(base, 'settings-'));
const folder = path.join(run, 'documents');
const data = path.join(run, 'preferences');
await fs.mkdir(folder); await fs.mkdir(data);
const file = path.join(folder, 'original.md');
const original = '# Original document\n\n' + Array.from({ length: 40 }, (_, i) => `## Section ${i + 1}\n\nOriginal text. 원본 문서. 原始文档。原始文件。元の文書。\n`).join('\n');
await fs.writeFile(file, original);
// Simulate an existing workspace saved before language settings were available.
await fs.writeFile(path.join(data, 'workspace.json'), JSON.stringify({ roots: [folder], session: { tabs: [file], active: file, theme: 'light', zoom: 110 } }));
const env = { ...process.env, MARKDESK_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath: process.env.MARKDESK_EXECUTABLE || electronPath, args: process.env.MARKDESK_EXECUTABLE ? [] : [cwd], cwd, env });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#document h1').filter({ hasText: 'Original document' }).waitFor();
  await page.waitForFunction(() => document.querySelector('#status-position').dataset.state === 'ready');
  return page;
}
try {
  let page = await launch();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'existing workspaces default to English');
  assert.equal(await page.locator('#settings-button').getAttribute('aria-label'), 'Settings');
  for (const width of [900, 1440]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 960), width);
    await page.waitForFunction(width => innerWidth === width, width);
    const layout = await page.evaluate(() => {
      const search = document.querySelector('#quick-open').getBoundingClientRect();
      const brand = document.querySelector('.brand').getBoundingClientRect();
      const controls = document.querySelector('.window-controls').getBoundingClientRect();
      const settings = document.querySelector('#settings-button').getBoundingClientRect();
      const theme = document.querySelector('#theme-toggle').getBoundingClientRect();
      return { center: (search.left + search.right) / 2, width: innerWidth, noOverlap: brand.right < search.left && search.right < controls.left, gearAboveTheme: settings.bottom <= theme.top };
    });
    assert.ok(Math.abs(layout.center - layout.width / 2) < 1, `search centered at ${width}px`);
    assert.ok(layout.noOverlap && layout.gearAboveTheme, 'search and settings fit without overlap');
  }
  const cases = [
    ['ko', '설정', '시작하기', 'Markdown 폴더 추가'],
    ['zh-Hans', '设置', '入门指南', '添加 Markdown 文件夹'],
    ['zh-Hant', '設定', '使用入門', '新增 Markdown 資料夾'],
    ['ja', '設定', '使い方', 'Markdown フォルダーを追加'],
    ['en', 'Settings', 'Getting started', 'Add Markdown folders']
  ];
  for (const [code, title, welcome, folderTitle] of cases) {
    await page.locator('#source-toggle').click();
    await page.locator('.source-view').waitFor();
    const source = await page.locator('.source-view').textContent();
    await page.locator('#document-scroll').evaluate(el => { el.scrollTop = 450; });
    const scroll = await page.locator('#document-scroll').evaluate(el => el.scrollTop);
    await page.locator('#settings-button').click();
    assert.equal(await page.locator('#language-select option').count(), 5);
    await page.locator('#language-select').selectOption(code);
    await page.waitForFunction(async code => (await window.markdesk.workspace()).session.language === code, code);
    assert.equal(await page.locator('html').getAttribute('lang'), code);
    assert.equal(await page.locator('#settings-title').textContent(), title);
    assert.equal(await page.locator('.source-view').textContent(), source, 'changing the UI language preserves document source');
    assert.ok(Math.abs(await page.locator('#document-scroll').evaluate(el => el.scrollTop) - scroll) < 3, 'reading position survives language change');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#settings-dialog').evaluate(el => el.open), false);
    assert.equal(await page.locator('#settings-button').evaluate(el => el === document.activeElement), true, 'Escape returns focus to the gear');
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async (_window, options) => { globalThis.testDialogTitle = options.title; return { canceled: true, filePaths: [] }; }; });
    await page.locator('#add-folder').click();
    assert.equal(await app.evaluate(() => globalThis.testDialogTitle), folderTitle, 'native folder picker uses the chosen language');
    await page.locator('#source-toggle').click();
    await page.locator('#help-button').click();
    await page.waitForFunction(text => document.querySelector('[data-tab="welcome"]')?.textContent.includes(text), welcome);
    await page.locator('.diagram-canvas svg').waitFor();
    assert.equal(await page.locator('.diagram-error').count(), 0, 'translated guide diagram renders');
    await page.locator('#settings-button').click();
    await page.screenshot({ path: path.join(cwd, 'artifacts', `settings-${code}.png`) });
    await page.locator('#settings-close').click();
    await app.close(); app = undefined;
    page = await launch();
    assert.equal(await page.locator('html').getAttribute('lang'), code, `${code} restored after restarting`);
    assert.equal(await page.locator('#language-select').inputValue(), code);
    assert.equal(await page.locator('#zoom-reset').textContent(), '110%');
    assert.equal(await page.locator('#folder-badge').textContent(), '1');
    assert.equal(await page.locator('#settings-button').getAttribute('aria-label'), title);
  }
  const state = await page.evaluate(() => window.markdesk.workspace());
  await page.evaluate(session => window.markdesk.saveSession({ ...session, language: 'unsupported' }), state.session);
  assert.equal((await page.evaluate(() => window.markdesk.workspace())).session.language, 'en', 'unsupported language falls back to English');
  await page.locator('#theme-toggle').click();
  await page.locator('#settings-button').click();
  await page.keyboard.press('Control+p');
  assert.equal(await page.locator('#palette').evaluate(el => el.open), false, 'settings isolates app shortcuts');
  await page.screenshot({ path: path.join(cwd, 'artifacts', 'settings-dark.png') });
  await page.mouse.click(10, 100);
  assert.equal(await page.locator('#settings-dialog').evaluate(el => el.open), false, 'backdrop closes settings');
  assert.equal(await fs.readFile(file, 'utf8'), original, 'original Markdown remains unchanged');
  assert.deepEqual(errors, []);
  await app.close(); app = undefined;
  assert.equal(path.dirname(run), base);
  await fs.rm(run, { recursive: true, force: true });
  console.log('PASS: centered search at 900/1440px, settings dialog and keyboard focus, all five languages, native dialog titles, restart persistence, existing tabs/zoom, source and reading position, unsupported-language fallback.');
} catch (error) {
  if (app) { try { await (await app.firstWindow()).screenshot({ path: path.join(run, 'failure.png') }); } catch {} }
  throw error;
} finally {
  if (app) await app.close();
}
