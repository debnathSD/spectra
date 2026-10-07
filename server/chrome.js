import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME_PROFILE_DIR } from './config.js';

const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ],
  win32: [
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
};

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  return (
    (CANDIDATES[os.platform()] || []).find(p => p && fs.existsSync(p)) || null
  );
}

/**
 * Starts a dedicated Chrome. Its profile lives in .chrome-profile/ so logins
 * (Superset SSO, cookies) survive between sessions, and it is separate from
 * your everyday browser profile.
 */
export async function launchChrome({ headless = false } = {}) {
  const executablePath = findChrome();
  if (!executablePath) {
    throw new Error(
      'Chrome was not found. Set CHROME_PATH to its executable, or start Chrome with --remote-debugging-port=9222 and use “Attach”.',
    );
  }
  fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
  const options = {
    executablePath,
    headless: headless ? 'new' : false,
    userDataDir: CHROME_PROFILE_DIR,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1600,1000',
      '--enable-precise-memory-info',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      ...(process.env.PERF_CHROME_ARGS
        ? process.env.PERF_CHROME_ARGS.split(' ')
        : []),
    ],
  };
  try {
    return await puppeteer.launch(options);
  } catch (err) {
    // A second Chrome on the same profile (e.g. the UI's window while running the CLI) cannot start.
    const locked = ['SingletonLock', 'lockfile'].some(f =>
      fs.existsSync(path.join(CHROME_PROFILE_DIR, f)),
    );
    throw new Error(
      locked
        ? `Chrome could not start because another Chrome is already using the profile ${CHROME_PROFILE_DIR}. Close that window (Close Chrome in the UI), or use a separate profile: PERF_CHROME_PROFILE_DIR=/tmp/perf-chrome-2.`
        : `Chrome failed to start (${err.message}). Check CHROME_PATH (${executablePath}).`,
    );
  }
}

export function attachChrome(browserURL) {
  return puppeteer.connect({ browserURL, defaultViewport: null });
}
