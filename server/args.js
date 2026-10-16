/**
 * Tiny argv parser shared by the CLI scripts: `--name value` options, bare
 * `--flag`s, and positionals. `values` lists the options that take a value, so
 * their value is never mistaken for a positional.
 */
export function parseArgs(argv, { values = [] } = {}) {
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (values.includes(a.slice(2))) i++;
    } else positionals.push(a);
  }
  const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : (argv[i + 1] ?? true);
  };
  const flag = name => argv.includes(`--${name}`);
  return { opt, flag, positionals };
}

/** A positive integer option, or an Error naming the option. */
export function intOption(raw, name, { min = 1, max = Infinity, fallback } = {}) {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`--${name} must be a whole number from ${min} to ${max} (got ${raw === true ? 'nothing' : raw}).`);
  return n;
}
