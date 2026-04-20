'use strict';

/**
 * Runs the Angular CLI with `--define` for OpenRouter so values come from
 * root `.env` or `process.env`, not from any tracked `.ts` file.
 *
 * Usage: node scripts/ng-with-openrouter-env.cjs serve
 *        node scripts/ng-with-openrouter-env.cjs build --configuration=production
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1).replace(/\\n/g, '\n');
    }
    out[k] = v;
  }
  return out;
}

const fromFile = parseEnvFile(envPath);
const key = (fromFile.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? '').trim();
const modelRaw = (fromFile.OPENROUTER_MODEL ?? process.env.OPENROUTER_MODEL ?? '').trim();
const model = modelRaw || 'openrouter/free';

/** esbuild/CLI expect a JS literal; JSON.stringify(s) is a valid string literal including quotes. */
const defineKeyLiteral = JSON.stringify(key);
const defineModelLiteral = JSON.stringify(model);

const ngArgs = process.argv.slice(2);
if (ngArgs.length === 0) {
  console.error('Usage: node scripts/ng-with-openrouter-env.cjs <ng-args…>  e.g. serve  or  build --configuration=production');
  process.exit(1);
}

// `--define` must follow the ng subcommand (`build`, `serve`, …), not sit before it.
const subcommand = ngArgs[0];
const subRest = ngArgs.slice(1);
const ngBin = path.join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const args = [
  ngBin,
  subcommand,
  '--define',
  `OPENROUTER_API_KEY=${defineKeyLiteral}`,
  '--define',
  `OPENROUTER_MODEL=${defineModelLiteral}`,
  ...subRest,
];

const r = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
});

process.exit(r.status === null ? 1 : r.status);
