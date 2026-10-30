import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const cwd = process.cwd();
const { version, build } = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
const base = path.join(cwd, '.test-data');
await fs.mkdir(base, { recursive: true });
const data = await fs.mkdtemp(path.join(base, 'portable-'));
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const env = { ...process.env, MARKDESK_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
const launcher = spawn(path.join(cwd, 'release', build.portable.artifactName.replace('${version}', version).replace('${arch}', 'x64')), [`--remote-debugging-port=${port}`, path.join(cwd, 'examples', 'README.md')], { cwd, env, windowsHide: true, stdio: 'ignore' });
let launchError;
launcher.on('error', (error) => { launchError = error; });
let browser;
try {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent('page');
  await page.locator('#document h1').filter({ hasText: 'playground' }).waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.diagram-canvas svg').length === 3);
  assert.equal(await page.locator('.diagram-error').count(), 0);
  await page.locator('#document img').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const img = document.querySelector('#document img'); return img.complete && img.naturalWidth > 0; });
  await page.locator('#document-scroll').evaluate((node) => { node.scrollTop = 0; });
  await page.screenshot({ path: path.join(cwd, 'artifacts', 'markdesk-portable.png') });
  await page.getByRole('heading', { name: '요청 시퀀스', exact: true }).evaluate((element) => { const scroll = document.querySelector('#document-scroll'); scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 24; });
  await page.locator('#source-toggle').click();
  await page.locator('.source-line').filter({ hasText: /^## 요청 시퀀스$/ }).waitFor();
  assert.ok(await page.locator('.source-line').filter({ hasText: /^## 요청 시퀀스$/ }).evaluate((el) => Math.abs(el.getBoundingClientRect().top - document.querySelector('#document-scroll').getBoundingClientRect().top - 24) < 6));
  await page.locator('#source-toggle').click();
  await page.waitForFunction(() => document.querySelectorAll('.diagram-canvas svg').length === 3);
  await page.waitForFunction(() => { const el = document.querySelector('#요청-시퀀스'); return Math.abs(el.getBoundingClientRect().top - document.querySelector('#document-scroll').getBoundingClientRect().top - 24) < 6; });
  await page.locator('[data-folder]').filter({ hasText: 'docs' }).click();
  await page.locator('[data-file]').filter({ hasText: 'architecture.md' }).click();
  await page.getByRole('heading', { name: 'Architecture', exact: true }).waitFor();
  await page.locator('.diagram-canvas svg').waitFor();
  await page.locator('[data-tab]').filter({ hasText: /^README\.md$/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.diagram-canvas svg').length === 3 && Math.abs(document.querySelector('#요청-시퀀스').getBoundingClientRect().top - document.querySelector('#document-scroll').getBoundingClientRect().top - 24) < 6);
  await page.locator('#edit-toggle').click();
  const editor = page.locator('#markdown-editor');
  const original = await editor.inputValue();
  await editor.fill('/table');
  await page.locator('#slash-menu [role="option"]').waitFor();
  await page.keyboard.press('Enter');
  assert.match(await editor.inputValue(), /^\| A \| B \|/);
  await editor.fill(original);
  assert.equal(await page.locator('#save-file').isDisabled(), true, 'portable editing leaves the example unchanged');
  await page.evaluate(() => window.markdesk.window('close')).catch(() => {});
  console.log('PASS: portable EXE, diagrams, local images, reading positions, editing and slash completion.');
} finally {
  if (browser) await browser.close();
  launcher.kill();
}
