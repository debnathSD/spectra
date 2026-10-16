/**
 * Per-project settings: spectra.config.json in the profiled project's root
 * (or the file passed with --config). Today it holds performance budgets:
 *
 *   { "budgets": { "tbtMs": 200, "lcpMs": 2500, "cls": 0.1, "criticalFindings": 0 } }
 */
import fs from 'node:fs';
import path from 'node:path';
import { FRONTEND_ROOT } from './config.js';
import { validateBudgets } from '../shared/result.js';

export const CONFIG_FILE = 'spectra.config.json';

/** @returns {{file: string|null, budgets: object}} — throws a readable Error on bad config */
export function loadProjectConfig(explicitFile) {
  const file = explicitFile ? path.resolve(explicitFile) : path.join(FRONTEND_ROOT, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    if (explicitFile) throw new Error(`config file not found: ${file}`);
    return { file: null, budgets: {} };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}).`);
  }
  const checked = validateBudgets(raw?.budgets);
  if (!checked.ok) throw new Error(`${path.basename(file)}: ${checked.error}`);
  return { file, budgets: checked.budgets };
}
