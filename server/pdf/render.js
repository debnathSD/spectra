/**
 * HTML -> PDF with the headless Chrome this tool already depends on. A throwaway
 * profile directory is used so it never collides with the Chrome window the
 * profiler itself launched (they would fight over one profile lock).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../chrome.js';
import { footerTemplate, renderComparisonHtml } from './template.js';

/**
 * @param {object} comparison  result of compareSides()
 * @param {'summary'|'detailed'} kind
 * @returns {Promise<Buffer>}
 */
export async function renderComparisonPdf(comparison, kind) {
  const executablePath = findChrome();
  if (!executablePath) {
    throw new Error(
      'Chrome was not found, and it is needed to render the PDF. Set CHROME_PATH to its executable.',
    );
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-pdf-'));
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    userDataDir: profile,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(renderComparisonHtml(comparison, kind), {
      waitUntil: 'load',
    });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(comparison, kind),
      margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

export function pdfFileName(comparison, kind) {
  const clean = value =>
    String(value || '')
      .replace(/[^\w-]/g, '')
      .slice(0, 12);
  const b = clean(comparison.before.git?.shortHash) || 'before';
  const a = clean(comparison.after.git?.shortHash) || 'after';
  return `perf-compare_${b}_${a}_${kind}.pdf`;
}
