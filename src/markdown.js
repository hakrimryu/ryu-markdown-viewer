import { t } from './i18n';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import math from '@traptitech/markdown-it-katex';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'style' && !node.closest?.('.katex')) data.keepAttr = false;
});
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const md = new MarkdownIt({
  html: true, linkify: true, typographer: true,
  highlight(code, lang) {
    return lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : escapeHtml(code);
  }
}).use(taskLists).use(footnote).use(math, { throwOnError: false, errorColor: '#e99d93', strict: 'ignore' });
md.core.ruler.after('block', 'source-lines', (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting === 1) {
      token.attrSet('data-source-start', token.map[0]);
      token.attrSet('data-source-end', token.map[1]);
    }
  }
});
const sourceAttrs = (token) => token.map ? ` data-source-start="${token.map[0]}" data-source-end="${token.map[1]}"` : '';
for (const type of ['math_block', 'code_block']) {
  const render = md.renderer.rules[type];
  md.renderer.rules[type] = (tokens, index, options, env, self) => `<div${sourceAttrs(tokens[index])}>${render(tokens, index, options, env, self)}</div>`;
}
const fence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (token.info.trim().toLowerCase() === 'mermaid') return `<div class="diagram" data-diagram="true"${sourceAttrs(token)}><pre>${escapeHtml(token.content)}</pre></div>`;
  return `<div class="code-block"${sourceAttrs(token)}><div class="code-label">${escapeHtml(token.info.trim().split(/\s/)[0] || 'text')}</div>${fence(tokens, index, options, env, self)}</div>`;
};
const blockquote = md.renderer.rules.blockquote_open;
md.renderer.rules.blockquote_open = (tokens, index, options, env, self) => {
  const inline = tokens[index + 2];
  const match = inline?.type === 'inline' && inline.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
  if (match) {
    if (inline.children?.[0]?.type === 'text') inline.children[0].content = inline.children[0].content.replace(match[0].trim(), '');
    return `<blockquote class="callout ${match[1].toLowerCase()}"${sourceAttrs(tokens[index])}><div class="callout-title">${t(match[1].toUpperCase())}</div>`;
  }
  return blockquote ? blockquote(tokens, index, options, env, self) : '<blockquote>';
};
export function renderMarkdown(content) {
  return DOMPurify.sanitize(md.render(content), { ADD_TAGS: ['annotation'], ADD_ATTR: ['encoding'], FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'script'], ALLOW_DATA_ATTR: true });
}
