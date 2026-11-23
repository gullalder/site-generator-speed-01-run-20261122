// Alternate fresh processes, including parse, build, JSON output and startup.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const kit = resolve(process.argv[2] ?? '.');
const output = mkdtempSync(join(tmpdir(), 'site-bench-'));
const env = { ...process.env, MAKEFUN_INPUT_DIR: join(kit, 'practice/input'), MAKEFUN_OUTPUT_DIR: output };
const drivers = { baseline: join(kit, 'baselines/makefun-site/main.ts'), mine: resolve('main.ts') };
const results = { baseline: [], mine: [] };
const expected = JSON.parse(readFileSync(join(kit, 'practice/reference/expected.json'), 'utf8')).cases.map(c => c.output);
try {
  for (let round = 0; round < 8; round++) {
    for (const name of round % 2 ? ['mine', 'baseline'] : ['baseline', 'mine']) {
      // Bash time accounts for the child process, including V8 helper threads.
      const result = spawnSync('/bin/bash', ['-c', 'TIMEFORMAT="%U %S %R"; time "$1" "$2"', 'site-bench', process.execPath, drivers[name]], { env, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
      const [user, system, wall] = result.stderr.trim().split('\n').at(-1).split(' ').map(Number);
      if (!isDeepStrictEqual(JSON.parse(readFileSync(join(output, 'answers.json'), 'utf8')), expected)) throw new Error(name + ' output mismatch');
      if (round) results[name].push({ cpu_ms: Math.round((user + system) * 1000), wall_ms: Math.round(wall * 1000) });
    }
  }
  for (const name of ['baseline', 'mine']) {
    const samples = results[name];
    const median = key => samples.map(s => s[key]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    console.log(name, JSON.stringify(samples), 'median CPU', median('cpu_ms'), 'ms; wall', median('wall_ms'), 'ms');
  }
} finally { rmSync(output, { recursive: true, force: true }); }
