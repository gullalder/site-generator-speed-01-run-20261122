// Independent implementation of the makefun-site text and front-matter dialects.
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = s => s.replace(/[&<>"']/g, c => entities[c]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const slug = s => s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[A-Z]/g, c => c.toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64).replace(/-+$/, '') || 'untitled';
function unique(s, used) {
  let result = s, n = 2;
  while (used.has(result)) result = s + '-' + n++;
  used.add(result);
  return result;
}
const months = 'January February March April May June July August September October November December'.split(' ');
const dateLong = s => s ? `${+s.slice(8)} ${months[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : '';
const directory = p => p.slice(0, Math.max(0, p.lastIndexOf('/')));

function front(text) {
  if (!text.startsWith('---\n') && text !== '---') throw 'no front matter';
  let pos = 4, end = -1, next;
  while (pos <= text.length) {
    next = text.indexOf('\n', pos);
    if (next < 0) next = text.length;
    if (text.slice(pos, next) === '---') { end = pos; break; }
    if (next === text.length) break;
    pos = next + 1;
  }
  if (end < 0) throw 'the front matter is not closed';
  const data = {};
  const lines = text.slice(4, end).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[ \t]*$/.test(line) || line[0] === '#') continue;
    const match = /^([a-z_]+):(?: (.*))?$/.exec(line);
    if (!match) throw `line ${i + 2} is not "key: value"`;
    const key = match[1], raw = (match[2] || '').replace(/[ \t]+$/, '');
    if (!['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug'].includes(key)) throw `unknown key "${key}"`;
    if (Object.hasOwn(data, key)) throw `key "${key}" is given twice`;
    if (!raw) throw `key "${key}" has no value`;
    let value = raw;
    const fail = reason => { throw `key "${key}": ${reason}`; };
    if (key === 'title' || key === 'summary') {
      if (raw[0] === '"') {
        if (raw.length < 2 || raw.at(-1) !== '"') fail('a quoted string is not closed');
        value = '';
        for (let j = 1; j < raw.length - 1; j++) {
          if (raw[j] === '\\') {
            const c = raw[++j];
            if ((c !== '"' && c !== '\\') || j === raw.length - 1) fail('a quoted string holds an escape other than \\" or \\\\');
            value += c;
          } else if (raw[j] === '"') fail('a quoted string holds a stray quote');
          else value += raw[j];
        }
      } else if (raw[0] === '[') fail('a bare string opens on [');
    } else if (key === 'date') {
      const y = +raw.slice(0, 4), m = +raw.slice(5, 7), d = +raw.slice(8);
      const max = m === 2 ? (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28) : [4,6,9,11].includes(m) ? 30 : 31;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || y < 1970 || y > 2099 || m < 1 || m > 12 || d < 1 || d > max) fail('not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)');
    } else if (key === 'tags') {
      if (raw[0] !== '[' || raw.at(-1) !== ']') fail('not a list [a, b]');
      value = raw.slice(1, -1).trim() === '' ? [] : raw.slice(1, -1).split(',').map(s => s.trim());
      if (value.some(s => !s || /["\[\]]/.test(s))) fail('an empty tag, or one holding " [ or ]');
    } else if (key === 'draft') {
      if (raw !== 'true' && raw !== 'false') fail('true or false');
      value = raw === 'true';
    } else if (key === 'layout') {
      if (!/^[a-z0-9-]+$/.test(raw)) fail('not a template name');
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) || raw.length > 64) fail('not a slug');
    data[key] = value;
  }
  if (!Object.hasOwn(data, 'title')) throw 'no title';
  return { data, body: next === text.length ? '' : text.slice(next + 1) };
}

// Inline scanning copies ordinary runs in one slice; only syntax needs recursion.
const escapable = new Set('\\`*_[]()#+-.!>');
function closing(s, token, from) {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\' && escapable.has(s[i + 1])) { i++; continue; }
    if (token === '*') {
      if (s[i] === '*' && s[i + 1] === '*') { i++; continue; }
      if (s[i] === '*') return i;
    } else if (s.startsWith(token, i)) return i;
  }
  return -1;
}
function inline(s, link) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && escapable.has(s[i + 1])) { out += escape(s[i + 1]); i += 2; continue; }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) { out += '<code>' + escape(s.slice(i + 1, end)) + '</code>'; i = end + 1; continue; }
    } else if (c === '*') {
      const strong = s[i + 1] === '*', width = strong ? 2 : 1;
      const end = closing(s, strong ? '**' : '*', i + width);
      if (end > i + width) {
        const tag = strong ? 'strong' : 'em';
        out += '<' + tag + '>' + inline(s.slice(i + width, end), link) + '</' + tag + '>';
        i = end + width; continue;
      }
      out += strong ? '**' : '*'; i += width; continue;
    } else if (c === '[') {
      const bracket = closing(s, ']', i + 1);
      const end = bracket >= 0 && s[bracket + 1] === '(' ? s.indexOf(')', bracket + 2) : -1;
      const target = end < 0 ? '' : s.slice(bracket + 2, end);
      if (target && !/\s/.test(target)) {
        out += '<a href="' + escape(link(target)) + '">' + inline(s.slice(i + 1, bracket), link) + '</a>';
        i = end + 1; continue;
      }
    }
    if (entities[c]) { out += entities[c]; i++; continue; }
    let j = i + 1;
    while (j < s.length && !'\\`*[&<>"\''.includes(s[j])) j++;
    out += s.slice(i, j); i = j;
  }
  return out;
}
const blank = s => /^[ \t]*$/.test(s);
const trim = s => s.replace(/^[ \t]+|[ \t]+$/g, '');
const fenceRE = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const headingRE = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const hrRE = /^(?:---|\*\*\*)[ \t]*$/;
const bulletRE = /^[-*] (.*)$/;
const orderedRE = /^(\d{1,9})\. (.*)$/;
function heading(s) { const m = headingRE.exec(s); return m && m[2] !== '' ? m : null; }
function markdown(body, link) {
  const lines = body.split('\n'), ids = new Set(), toc = [];
  let html = '', excerpt = '', gotExcerpt = false, i = 0;
  while (i < lines.length) {
    const line = lines[i++];
    if (blank(line)) continue;
    const f = fenceRE.exec(line);
    if (f) {
      html += '<pre><code' + (f[1] ? ' class="language-' + f[1] + '"' : '') + '>';
      while (i < lines.length && !/^```[ \t]*$/.test(lines[i])) html += escape(lines[i++]) + '\n';
      i++; html += '</code></pre>\n'; continue;
    }
    const h = heading(line);
    if (h) {
      const level = h[1].length, id = unique(slug(h[2]), ids), text = inline(h[2], link);
      html += `<h${level} id="${id}">${text}</h${level}>\n`;
      if (level === 2 || level === 3) toc.push({ level, id, html: text });
      continue;
    }
    if (hrRE.test(line)) { html += '<hr>\n'; continue; }
    if (line[0] === '>') {
      const parts = [];
      let current = line;
      do {
        const text = trim(current.replace(/^> ?/, ''));
        if (text) parts.push(text);
        if (i >= lines.length || lines[i][0] !== '>') break;
        current = lines[i++];
      } while (true);
      html += '<blockquote>\n' + (parts.length ? '<p>' + inline(parts.join('\n'), link) + '</p>\n' : '') + '</blockquote>\n';
      continue;
    }
    const b = bulletRE.exec(line), o = b ? null : orderedRE.exec(line);
    if (b || o) {
      const marker = o ? orderedRE : bulletRE, tag = o ? 'ol' : 'ul';
      html += o && +o[1] !== 1 ? `<ol start="${+o[1]}">\n` : '<' + tag + '>\n';
      let item = trim(o ? o[2] : b[1]);
      while (i < lines.length) {
        const m = marker.exec(lines[i]);
        if (m) { html += '<li>' + inline(item, link) + '</li>\n'; item = trim(o ? m[2] : m[1]); i++; }
        else if (/^ {2,}\S/.test(lines[i])) item += '\n' + trim(lines[i++]);
        else break;
      }
      html += '<li>' + inline(item, link) + '</li>\n</' + tag + '>\n'; continue;
    }
    const parts = [trim(line)];
    while (i < lines.length && !blank(lines[i]) && !fenceRE.test(lines[i]) && !heading(lines[i]) && !hrRE.test(lines[i])) parts.push(trim(lines[i++]));
    const text = inline(parts.join('\n'), link);
    if (!gotExcerpt) { excerpt = text; gotExcerpt = true; }
    html += '<p>' + text + '</p>\n';
  }
  return { html, excerpt, toc };
}

function valueText(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return Array.isArray(v) ? v.map(valueText).join(', ') : '';
}
const truth = v => Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
function lookup(scope, path) {
  let v = scope[path[0]];
  for (let i = 1; i < path.length; i++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[i])) return undefined;
    v = v[path[i]];
  }
  return v;
}

// Compile control flow to JavaScript once. Literal text stays a string constant.
function compile(name, source) {
  const error = s => { throw `template "${name}": ${s}`; };
  // Lexical failures precede structural failures in the reference, including
  // when a malformed interpolation occurs after an invalid control tag.
  for (let i = 0; i < source.length;) {
    const open = source.indexOf('{', i);
    if (open < 0) break;
    const tag = source[open + 1] === '%';
    if (!tag && source[open + 1] !== '{') { i = open + 1; continue; }
    const raw = !tag && source[open + 2] === '{', width = raw ? 3 : 2;
    const closer = tag ? '%}' : raw ? '}}}' : '}}';
    const end = source.indexOf(closer, open + width);
    if (end < 0) error('a ' + (tag ? '{%' : raw ? '{{{' : '{{') + ' is not closed');
    if (!tag) {
      const p = source.slice(open + width, end).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(p)) error(JSON.stringify(p) + ' is not a path');
    }
    i = end + closer.length;
  }
  const reads = new Set(), includes = [];
  const bound = () => new Set(stack.filter(n => n.kind === 'for').flatMap(n => [n.variable, 'loop']));
  const path = s => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(s)) error(JSON.stringify(s) + ' is not a path');
    const first = s.split('.')[0];
    if (!bound().has(first)) reads.add(first);
    return 'get(s,' + JSON.stringify(s.split('.')) + ')';
  };
  let code = 'let out="",v;', cursor = 0, pending = '', serial = 0;
  const stack = [];
  const flush = () => { if (pending) code += 'out+=' + JSON.stringify(pending) + ';'; pending = ''; };
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor);
    if (open < 0 || open + 1 === source.length) { pending += source.slice(cursor); break; }
    if (source[open + 1] !== '{' && source[open + 1] !== '%') { pending += source.slice(cursor, open + 1); cursor = open + 1; continue; }
    pending += source.slice(cursor, open);
    const tag = source[open + 1] === '%', raw = !tag && source[open + 2] === '{';
    const closer = tag ? '%}' : raw ? '}}}' : '}}', width = raw ? 3 : 2;
    const close = source.indexOf(closer, open + width);
    if (close < 0) error('a ' + (tag ? '{%' : raw ? '{{{' : '{{') + ' is not closed');
    const text = source.slice(open + width, close).trim(), end = close + closer.length;
    cursor = end;
    if (tag) {
      const start = source.lastIndexOf('\n', open - 1) + 1;
      const nl = source.indexOf('\n', end), stop = nl < 0 ? source.length : nl;
      if (blank(source.slice(start, open)) && blank(source.slice(end, stop))) {
        pending = pending.slice(0, pending.length - (open - start));
        cursor = nl < 0 ? source.length : nl + 1;
      }
    }
    flush();
    if (!tag) { code += 'out+=' + (raw ? 'txt(' : 'esc(txt(') + path(text) + (raw ? ');' : '));'); continue; }
    let m;
    const top = stack.at(-1);
    if ((m = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/.exec(text))) {
      const id = serial++;
      code += `{const xs${id}=${path(m[2])};if(Array.isArray(xs${id})){const parent${id}=s;for(let k${id}=0;k${id}<xs${id}.length;k${id}++){s=Object.create(parent${id});s[${JSON.stringify(m[1])}]=xs${id}[k${id}];s.loop={index:k${id}+1,first:k${id}===0,last:k${id}===xs${id}.length-1,length:xs${id}.length};`;
      stack.push({ kind: 'for', id, variable: m[1] });
    } else if ((m = /^if (not )?(\S+)$/.exec(text))) {
      code += 'if(' + (m[1] ? '!' : '') + 'yes(' + path(m[2]) + ')){';
      stack.push({ kind: 'if', else: false });
    } else if (text === 'else') {
      if (!top || top.kind !== 'if' || top.else) error('an else outside an if');
      top.else = true; code += '}else{';
    } else if (text === 'endfor' || text === 'endif') {
      const kind = text.slice(3);
      if (!top || top.kind !== kind) error(`an ${text} with no open ${kind}`);
      stack.pop();
      code += kind === 'for' ? `}s=parent${top.id};}}` : '}';
    } else if ((m = /^include "([a-z0-9-]+)"$/.exec(text))) {
      includes.push({ name: m[1], bound: bound() });
      code += `if(d<8)out+=inc(${JSON.stringify(m[1])},s,d+1);`;
    }
    else error('{% ' + text + ' %} is not a tag');
  }
  flush();
  if (stack.length) error('a ' + stack.at(-1).kind + ' is not closed');
  const fn = new Function('s', 'd', 'inc', 'get', 'txt', 'esc', 'yes', code + 'return out;');
  fn.reads = reads; fn.includes = includes;
  return fn;
}

export function run(input) {
  const templates = new Map(), report = [], broken = new Set(), output = {};
  for (const name of Object.keys(input.templates).sort()) {
    try { templates.set(name, compile(name, input.templates[name])); }
    catch (e) { if (typeof e !== 'string') throw e; report.push(e); }
  }
  const base = input.site.base_url.replace(/\/+$/, '');
  const sources = [], statics = [], byPath = new Map(), usedDirs = new Map();
  for (const file of [...input.files].sort((a, b) => compare(a.path, b.path))) {
    if (!file.path.endsWith('.md')) { statics.push(file); continue; }
    let s;
    try {
      s = { ...front(file.content.replace(/\r\n?/g, '\n')), path: file.path, post: file.path.startsWith('posts/') };
      const own = ['tags', 'page'].find(d => file.path.startsWith(d + '/'));
      if (own) throw own + "/ is the generator's own";
      if (s.post && !Object.hasOwn(s.data, 'date')) throw 'a post needs a date';
      s.layout = s.data.layout ?? (s.post ? 'post' : 'page');
      if (!templates.has(s.layout)) throw `layout "${s.layout}" is no template that parses`;
    } catch (e) { if (typeof e !== 'string') throw e; report.push(`refused ${file.path}: ${e}`); continue; }
    if (s.data.draft === true) { report.push('draft ' + file.path); continue; }
    const dir = s.post ? 'posts' : directory(s.path);
    if (!usedDirs.has(dir)) usedDirs.set(dir, new Set(dir === '' ? ['posts', 'tags', 'page'] : []));
    s.slug = unique(s.data.slug ?? slug(s.data.title), usedDirs.get(dir));
    s.outDir = dir ? dir + '/' + s.slug : s.slug;
    s.url = base + '/' + s.outDir + '/';
    sources.push(s); byPath.set(s.path, s);
  }
  const staticPaths = new Set(statics.map(f => f.path));
  for (const s of sources) {
    const dir = directory(s.path), links = new Map();
    const link = target => {
      if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/|#)/.test(target)) return target;
      if (links.has(target)) return links.get(target);
      const hash = target.indexOf('#'), rel = hash < 0 ? target : target.slice(0, hash), frag = hash < 0 ? '' : target.slice(hash);
      const parts = dir ? dir.split('/') : [];
      let valid = rel !== '';
      for (const part of rel.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') { if (!parts.length) { valid = false; break; } parts.pop(); }
        else parts.push(part);
      }
      const path = parts.join('/');
      let result = target;
      if (valid && byPath.has(path)) result = byPath.get(path).url + frag;
      else if (valid && staticPaths.has(path)) result = base + '/' + path + frag;
      else broken.add(`broken-link ${s.path} -> ${target}`);
      links.set(target, result); return result;
    };
    Object.assign(s, markdown(s.body, link));
  }
  const posts = sources.filter(s => s.post).sort((a, b) => compare(b.data.date, a.data.date) || compare(a.slug, b.slug));
  const tagMap = new Map(), slugCache = new Map();
  const tagSlug = name => { if (!slugCache.has(name)) slugCache.set(name, slug(name)); return slugCache.get(name); };
  for (const s of [...posts, ...sources.filter(s => !s.post)]) {
    const seen = new Set();
    s.tagRefs = [];
    for (const name of s.data.tags ?? []) {
      const id = tagSlug(name);
      if (seen.has(id)) continue;
      seen.add(id);
      let tag = tagMap.get(id);
      if (!tag) {
        tag = { name, slug: id, url: s.post ? `${base}/tags/${id}/` : '', posts: [] };
        if (s.post) tagMap.set(id, tag);
      }
      if (s.post) tag.posts.push(s);
      s.tagRefs.push({ name: tag.name, slug: tag.slug, url: tag.url });
    }
    s.card = {
      title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: dateLong(s.data.date),
      summary: s.data.summary ?? '', excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil((s.body.match(/\S+/g)?.length ?? 0) / 200)), tags: s.tagRefs,
    };
  }
  const tags = [...tagMap.values()].sort((a, b) => b.posts.length - a.posts.length || compare(a.slug, b.slug));
  const global = Object.assign(Object.create(null), {
    site: { title: input.site.title, base_url: base },
    tags: tags.map(t => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length })),
    recent: posts.slice(0, input.site.recent).map(s => s.card),
  });
  // Includes depend only on their free root names. Propagate those through
  // includes (subtracting local loop bindings), separately at each depth.
  const plans = new Map();
  function plan(name, depth) {
    const key = name + ':' + depth;
    if (plans.has(key)) return plans.get(key);
    const fn = templates.get(name);
    if (!fn) return null;
    const deps = new Set(fn.reads);
    if (depth < 8) for (const child of fn.includes) {
      const sub = plan(child.name, depth + 1);
      if (sub) for (const dep of sub.deps) if (!child.bound.has(dep)) deps.add(dep);
    }
    const p = { fn, deps: [...deps], cache: new Map() };
    plans.set(key, p); return p;
  }
  for (const name of templates.keys()) plan(name, 0);
  const include = (name, scope, depth) => {
    const p = plan(name, depth);
    if (!p) return '';
    let cache = p.cache;
    for (const dep of p.deps) {
      const value = scope[dep];
      let next = cache.get(value);
      if (!next) { next = new Map(); cache.set(value, next); }
      cache = next;
    }
    if (cache.has(p)) return cache.get(p);
    const html = p.fn(scope, depth, include, lookup, valueText, escape, truth);
    cache.set(p, html); return html;
  };
  const render = (name, vars) => templates.has(name) ? include(name, Object.assign(Object.create(global), vars), 0) : null;
  const linkRecord = s => s ? { title: s.card.title, url: s.url, date: s.card.date, date_long: s.card.date_long } : null;
  for (let i = 0; i < posts.length; i++) {
    posts[i].newer = linkRecord(posts[i - 1]); posts[i].older = linkRecord(posts[i + 1]);
  }
  for (const s of sources) output[s.outDir + '/index.html'] = render(s.layout, {
    page: { ...s.card, slug: s.slug, content: s.html, toc: s.toc, newer: s.newer ?? null, older: s.older ?? null, is_post: s.post },
  });
  const per = input.site.per_page, count = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = k => k === 1 ? base + '/' : `${base}/page/${k}/`;
  for (let k = 1; k <= count; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map(s => s.card),
      pager: { number: k, total: count, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === count ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map(s => s.card) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const all = render('tags', {});
  if (all !== null) output['tags/index.html'] = all;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }
  report.push(...broken); report.sort();
  report.push(`built ${sources.length - posts.length} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = report.join('\n') + '\n';
  return output;
}
