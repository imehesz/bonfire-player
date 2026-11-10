// `npm run seed`: fills an EMPTY local library with BonfireSTACK's own demo patches and covers, so
// there is something to listen to while developing. Talks to the running API (npm run api / dev).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries((fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '')
  .split('\n').map((l) => /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
const api = `http://127.0.0.1:${process.env.PORT || env.PORT || 5065}/api`;
const demos = path.resolve(root, process.env.BONFIRE_DEMOS || '../bonfirestack/public/demos');
const TAGS = {
  'first-spark': 'house', 'acid-breakfast': 'acid, techno', 'vandal-breaks': 'breaks, glitch', 'glass-garden': 'ambient',
  'industrial-furnace': 'industrial, ebm', 'odyssey': 'synthwave', 'polymeter-pastry': 'experimental', 'poor-girl': 'downtempo',
  'stranger-danger': 'synthwave, dark', 'torched-meringue': 'techno', 'veil-of-echoes': 'ambient, lo-fi',
};

const call = async (url, opts = {}) => {
  const r = await fetch(url, opts);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
};
const { token } = await call(`${api}/login`, { method: 'POST', body: JSON.stringify({ password: process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD }) });
const auth = { Authorization: `Bearer ${token}` };
if ((await call(`${api}/admin/tracks`, { headers: auth })).length) {
  console.log('The library already has tracks: nothing seeded.');
  process.exit(0);
}
for (const d of JSON.parse(fs.readFileSync(path.join(demos, 'index.json'), 'utf8'))) {
  const patch = JSON.parse(fs.readFileSync(path.join(demos, `${d.id}.json`), 'utf8'));
  const cover = path.join(demos, `${d.id}.jpg`);
  const image = fs.existsSync(cover) ? `data:image/jpeg;base64,${fs.readFileSync(cover).toString('base64')}` : undefined;
  const t = await call(`${api}/admin/tracks`, { method: 'POST', headers: auth, body: JSON.stringify({ title: d.name, description: d.description, tags: TAGS[d.id] ?? '', patch, image }) });
  console.log('added', t.id);
}
