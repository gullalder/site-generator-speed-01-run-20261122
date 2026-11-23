// Compare complete output trees, showing the first differing code unit.
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { run } from './solve.js';

const kit = process.argv[2];
if (!kit) throw new Error('Usage: node check.mjs /path/to/kit');
const cases = JSON.parse(readFileSync(kit + '/practice/input/cases.json', 'utf8'));
const expected = JSON.parse(readFileSync(kit + '/practice/reference/expected.json', 'utf8')).cases;
let passed = 0;
for (let i = 0; i < cases.length; i++) {
  const actual = run(cases[i].input), wanted = expected[i].output;
  if (isDeepStrictEqual(actual, wanted)) { passed++; continue; }
  for (const path of new Set([...Object.keys(actual), ...Object.keys(wanted)])) {
    if (actual[path] === wanted[path]) continue;
    const a = actual[path], b = wanted[path];
    let at = 0;
    if (typeof a === 'string' && typeof b === 'string') while (at < Math.min(a.length, b.length) && a[at] === b[at]) at++;
    console.error(cases[i].id, path, 'offset', at, '\nactual:', JSON.stringify(a?.slice(Math.max(0, at - 70), at + 150)), '\nwanted:', JSON.stringify(b?.slice(Math.max(0, at - 70), at + 150)));
    break;
  }
}
console.log(`practice ${passed}/${cases.length} exact`);
if (passed !== cases.length) process.exitCode = 1;
