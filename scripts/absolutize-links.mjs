#!/usr/bin/env node
/**
 * One-off maintenance: turn relative internal links (href="/p/...") into
 * absolute links (href="https://www.agadir-livraison.com/p/...") inside the
 * content of every live page and post of the 3 MOVO blogs (FR, EN, AR).
 *
 * Why: if someone copies the raw HTML of a page, absolute links keep pointing
 * to agadir-livraison.com instead of the copier's own domain.
 *
 * Safety:
 *   - MODE=dry-run (default) only reports what would change, nothing is written.
 *   - MODE=apply writes the changes with PATCH (title + content only).
 *   - The original content of every item to change is saved first to
 *     backup/links-backup.json (uploaded as a workflow artifact).
 *   - Only href values that start with a single "/" are changed.
 *
 * Env: BLOGGER_CLIENT_ID, BLOGGER_CLIENT_SECRET, BLOGGER_REFRESH_TOKEN, MODE
 */

import fs from 'node:fs';

const BLOGS = [
  { label: 'FR', id: '8452204387409245713', host: 'https://www.agadir-livraison.com' },
  { label: 'EN', id: '4591946336174594751', host: 'https://en.agadir-livraison.com' },
  { label: 'AR', id: '6023995067592991740', host: 'https://ar.agadir-livraison.com' },
];

const { BLOGGER_CLIENT_ID, BLOGGER_CLIENT_SECRET, BLOGGER_REFRESH_TOKEN } = process.env;
const MODE = (process.env.MODE || 'dry-run').trim();
const APPLY = MODE === 'apply';
const API = 'https://www.googleapis.com/blogger/v3';

async function getAccessToken() {
  if (!BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET || !BLOGGER_REFRESH_TOKEN) {
    throw new Error('Missing BLOGGER_* secrets.');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: BLOGGER_CLIENT_ID,
      client_secret: BLOGGER_CLIENT_SECRET,
      refresh_token: BLOGGER_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function api(token, path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function listAll(token, blogId, kind) {
  const items = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ fetchBodies: 'true', status: 'live' });
    if (kind === 'posts') qs.set('maxResults', '50');
    if (pageToken) qs.set('pageToken', pageToken);
    const json = await api(token, `/blogs/${blogId}/${kind}?${qs}`);
    items.push(...(json.items || []));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return items;
}

function absolutize(html, host) {
  let count = 0;
  const out = html.replace(/href=(["'])\/(?!\/)/g, (m, q) => {
    count++;
    return `href=${q}${host}/`;
  });
  return { out, count };
}

async function main() {
  console.log(`MODE = ${MODE}`);
  const token = await getAccessToken();

  // Pass 1: collect everything that would change.
  const todo = [];
  for (const blog of BLOGS) {
    for (const kind of ['pages', 'posts']) {
      const items = await listAll(token, blog.id, kind);
      let links = 0;
      let n = 0;
      for (const it of items) {
        if (!it.title || !it.title.trim()) {
          console.log(`[${blog.label}] SKIP ${kind} ${it.url}: empty title`);
          continue;
        }
        const { out, count } = absolutize(it.content || '', blog.host);
        if (!count) continue;
        todo.push({ blog, kind, it, out, count });
        links += count;
        n++;
      }
      console.log(`== [${blog.label}] ${kind}: ${items.length} live, ${n} to change, ${links} links`);
    }
  }

  // Backup BEFORE any write.
  fs.mkdirSync('backup', { recursive: true });
  fs.writeFileSync(
    'backup/links-backup.json',
    JSON.stringify(todo.map(({ blog, kind, it }) => ({ blog: blog.label, blogId: blog.id, kind, id: it.id, url: it.url, title: it.title, content: it.content })), null, 1),
  );

  const totalLinks = todo.reduce((s, t) => s + t.count, 0);
  console.log(`TOTAL: ${todo.length} items, ${totalLinks} links.`);
  if (!APPLY) {
    todo.slice(0, 15).forEach((t) => console.log(`  would change ${t.it.url} (${t.count})`));
    console.log('Dry run: nothing written.');
    return;
  }

  // Pass 2: write.
  let ok = 0;
  let failed = 0;
  for (const t of todo) {
    try {
      await api(token, `/blogs/${t.blog.id}/${t.kind}/${t.it.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: t.it.title, content: t.out }),
      });
      ok++;
    } catch (err) {
      failed++;
      console.error(`FAILED ${t.it.url}: ${err.message}`);
    }
  }
  console.log(`Applied: ${ok} updated, ${failed} failed.`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
