import hljs from 'highlight.js/lib/core';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import less from 'highlight.js/lib/languages/less';
import scss from 'highlight.js/lib/languages/scss';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

const LANGUAGES = { css, javascript, json, less, scss, typescript, xml };
Object.entries(LANGUAGES).forEach(([name, def]) =>
  hljs.registerLanguage(name, def),
);

const EXT_TO_LANGUAGE = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  less: 'less',
  scss: 'scss',
  html: 'xml',
  svg: 'xml',
};
const MAX_HIGHLIGHT_CHARS = 400_000;

const escapeHtml = text =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Returns HTML that is always escaped (highlight.js escapes its output). */
export function highlightSource(path, content) {
  const language = EXT_TO_LANGUAGE[path.split('.').pop().toLowerCase()];
  if (!language || content.length > MAX_HIGHLIGHT_CHARS)
    return escapeHtml(content);
  try {
    return hljs.highlight(content, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(content);
  }
}
