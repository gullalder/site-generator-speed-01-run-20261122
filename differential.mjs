// Additional deterministic draws and dialect edge cases against the kit oracle.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { run } from './solve.js';

const kit = resolve(process.argv[2] ?? '.');
const load = path => import(pathToFileURL(kit + '/' + path).href);
const { build } = await load('baselines/makefun-site/vendor/makefun-site/index.js');
const { generate } = await load('program/generator/subject/sites.mjs');
const { streamFor } = await load('program/generator/rng.ts');
let checked = 0;
function check(input, label) {
  const a = run(input), b = build(input);
  if (!isDeepStrictEqual(a, b)) {
    for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[p] !== b[p]) {
      console.error(label, p, JSON.stringify(a[p]), JSON.stringify(b[p])); break;
    }
    throw new Error('Differential mismatch');
  }
  checked++;
}
const templates = {
  page: '{{ page.title }}|{{{ page.content }}}|{{{ page.excerpt }}}|{% for h in page.toc %}{{ h.id }};{% endfor %}',
  post: '{{ page.date_long }}|{{ page.title }}|{{{ page.content }}}',
  index: '{% for p in posts %}{{ p.title }}{% include "card" %}{% endfor %}',
  card: '{{ p.url }}{% for t in p.tags %}{{ t.name }}={{ t.url }}{% endfor %}',
  tag: '{% for p in tag.posts %}{% include "card" %}{% endfor %}',
  tags: '{{ tags }}',
  cycle: 'x{% include "cycle" %}',
};
const bodies = [
  '', '# \t\n## One\n## One\n### *One*\n####### nope\n',
  '>\n> a\n>\t b\n\n4. a\n  continued\n5. b\n\n- a\n* b\n',
  'text\n> still paragraph\n- still paragraph\n***\n===\n',
  '```c++\na & <b>\n```\n\n```\nno closer\n',
  '`x` `` **a *b* c** ***a*** ** ** * * a\\*b\\* \\q \\> [x](missing) [x](#ok) [x](../a) [](/) [a\\]b](x)\n',
];
const frontLines = ['', '---', 'title: x', 'title: "x\\q"', 'title: "x"z"', 'title: "x\\"', 'title: [x]', 'Title: x', 'summary:', 'date: 2000-02-29', 'date: 2100-02-29', 'tags: [a,,b]', 'tags: []', 'slug: Bad', 'draft: true', 'layout: cycle'];
const files = bodies.map((body, i) => ({ path: `a${i}.md`, content: '---\ntitle: posts\n---\n' + body }));
for (let i = 0; i < frontLines.length; i++) files.push({ path: `bad${i}.md`, content: `---\n${frontLines[i]}\ntitle: after\n---\nbody` });
files.push({ path: 'posts/a.md', content: '---\ntitle: Post\ndate: 2000-02-29\ntags: [Café, cafe, Q&A]\n---\ntext' });
files.push({ path: 'tags/x.md', content: '---\ntitle: x\n---\nx' });
const site = { title: 'Test & site', base_url: '/base///', recent: 3, per_page: 2 };
check({ site, templates, files }, 'edges');
for (const text of ['{% else %}{{ bad path }}', '{% if page %}', '{% for x in page %}{% endif %}', '{% wat %}{{', '{{{ x }}', '{% if x %}{% else %}{% else %}', '{% for x in bad-path %}', '{% include "missing" %}', '{% include "cycle" %}', '{% for p in recent %}{% include "card" %}{% endfor %}']) {
  check({ site, templates: { ...templates, page: text }, files }, 'template ' + text);
}
for (let seed = 0; seed < 8; seed++) for (let index = 0; index < 3; index++) {
  check(generate(streamFor(seed.toString(16).padStart(64, '0'), 'case', index), index), `seed ${seed}, case ${index}`);
}
console.log(`${checked} additional differential cases exact`);
