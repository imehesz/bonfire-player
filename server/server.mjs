// BonfireSTACK Tracks API. No dependencies, Node 16+.
// Public:  GET  api/tracks                    the published tracks
//          GET  api/tracks/<id>/patch         a track's patch (BonfireSTACK JSON)
//          GET  api/media/images/<file>       a track's ambiance image
//          GET  api/media/audio/<file>        a track's MP3 version (when it has one, the player plays that)
// Admin:   POST api/login {password}          -> { token } (send it as Authorization: Bearer <token>)
//          GET  api/admin/tracks              every track, drafts too
//          POST api/admin/tracks              new track   { title, description, tags, published, patch, image, audio }
//          PUT  api/admin/tracks/<id>         change one  (any of the fields above; image / audio '' removes it)
//          DELETE api/admin/tracks/<id>
// `image` is a data: URL (the admin page shrinks it first); `audio` a data:audio/mpeg URL of an MP3 of
// at most a minute (the admin page checks the length, the server the size). Everything is kept as
// plain files under DATA_DIR: tracks.json, patches/<id>.json, images/<id>.<ext>, audio/<id>.mp3.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

// .env (KEY=value lines) without a dependency; real environment variables win
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) {
  console.error('ADMIN_PASSWORD is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}
const PORT = Number(process.env.PORT || 5065);
const DATA = path.resolve(process.env.DATA_DIR || path.join(here, 'data'));
const KEY = crypto.createHash('sha256').update(`${PASSWORD}\n${process.env.SESSION_SECRET || ''}`).digest();
const TOKEN_HOURS = 12;
const MAX_BODY = 12 * 1024 * 1024;
const AUDIO_MAX = 3 * 1024 * 1024; // a minute of MP3 at 320 kbps is ~2.4 MB
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME = { mp3: 'audio/mpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', ico: 'image/x-icon', txt: 'text/plain' };

for (const d of ['', 'patches', 'images', 'audio']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
const INDEX = path.join(DATA, 'tracks.json');
const readTracks = () => (fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : []);
function writeFile(file, data) {
  const tmp = `${file}.${process.pid}.tmp`; // write + rename, so a crash never leaves half a file
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
const writeTracks = (list) => writeFile(INDEX, JSON.stringify(list, null, 1));

// ---- auth ----
const sign = (exp) => crypto.createHmac('sha256', KEY).update(String(exp)).digest('hex');
const newToken = () => {
  const exp = Date.now() + TOKEN_HOURS * 3600e3;
  return `${exp}.${sign(exp)}`;
};
const same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
function authed(req) {
  const m = /^Bearer (\d+)\.([0-9a-f]+)$/.exec(req.headers.authorization || '');
  return !!m && Number(m[1]) > Date.now() && same(m[2], sign(m[1]));
}

// ---- helpers ----
function send(res, status, body, type = 'application/json', extra = {}) {
  const data = type === 'application/json' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(data);
}
const fail = (res, status, error) => send(res, status, { error });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('That upload is too big (12 MB at most).'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('The request was not valid JSON.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'track';
const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : String(tags ?? '').split(','))
  .map((t) => String(t).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 24)).filter(Boolean))].slice(0, 12);

function checkPatch(patch) {
  if (!patch || typeof patch !== 'object' || !Array.isArray(patch.modules) || !Array.isArray(patch.cables)) {
    throw Object.assign(new Error('That file is not a BonfireSTACK patch (no modules / cables in it).'), { status: 400 });
  }
  if (!patch.modules.some((m) => m.type === 'output')) throw Object.assign(new Error('That patch has no OUTPUT module, so it would be silent.'), { status: 400 });
}

// data: URL -> { ext, bytes }
function decodeImage(dataUrl) {
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  const ext = m && IMAGE_TYPES[m[1]];
  if (!ext) throw Object.assign(new Error('The image has to be a JPEG, PNG or WebP.'), { status: 400 });
  return { ext, bytes: Buffer.from(m[2], 'base64') };
}

function removeImage(track) {
  if (track.image) fs.rmSync(path.join(DATA, 'images', track.image), { force: true });
  track.image = null;
}
function saveImage(track, dataUrl) {
  const { ext, bytes } = decodeImage(dataUrl);
  removeImage(track);
  track.image = `${track.id}.${ext}`;
  writeFile(path.join(DATA, 'images', track.image), bytes);
}

// data:audio URL -> MP3 bytes (ID3 tag or an MPEG audio frame header at the start)
function decodeAudio(dataUrl) {
  const m = /^data:audio\/(?:mpeg|mp3|mpeg3|x-mpeg-3);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  const bytes = m ? Buffer.from(m[1], 'base64') : null;
  const mp3 = bytes && bytes.length > 4 && (bytes.toString('latin1', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
  if (!mp3) throw Object.assign(new Error('The audio has to be an MP3 file.'), { status: 400 });
  if (bytes.length > AUDIO_MAX) throw Object.assign(new Error('That MP3 is too big (3 MB at most; a minute at 320 kbps fits).'), { status: 413 });
  return bytes;
}
function removeAudio(track) {
  if (track.audio) fs.rmSync(path.join(DATA, 'audio', track.audio), { force: true });
  track.audio = null;
}
function saveAudio(track, dataUrl) {
  const bytes = decodeAudio(dataUrl);
  removeAudio(track);
  track.audio = `${track.id}.mp3`;
  writeFile(path.join(DATA, 'audio', track.audio), bytes);
}

// what listeners get: no drafts, no server-side fields
const publicTrack = (t) => ({
  id: t.id, title: t.title, description: t.description, tags: t.tags, created: t.created, updated: t.updated,
  image: t.image ? `api/media/images/${t.image}?v=${t.updated}` : null,
  audio: t.audio ? `api/media/audio/${t.audio}?v=${t.updated}` : null,
  modules: t.modules ?? null, bpm: t.bpm ?? null,
});
const adminTrack = (t) => ({ ...publicTrack(t), published: !!t.published, warnings: t.warnings ?? [] });

// facts about a patch worth keeping in the index (no need to open every patch to list tracks)
function describePatch(track, patch) {
  track.modules = patch.modules.length;
  track.bpm = patch.modules.find((m) => m.type === 'clock')?.params?.bpm ?? 120;
  const warnings = [];
  if (patch.localSounds?.length) warnings.push(`Uses samples that only exist on your computer (${patch.localSounds.join(', ')}): listeners will not hear those parts.`);
  track.warnings = warnings;
}

function applyFields(track, body) {
  if (body.audio) decodeAudio(body.audio); // a bad MP3 fails before anything is written
  if (body.title !== undefined) {
    const title = String(body.title).trim().slice(0, 80);
    if (!title) throw Object.assign(new Error('A track needs a title.'), { status: 400 });
    track.title = title;
  }
  if (body.description !== undefined) track.description = String(body.description).trim().slice(0, 600);
  if (body.tags !== undefined) track.tags = cleanTags(body.tags);
  if (body.published !== undefined) track.published = !!body.published;
  if (body.patch !== undefined) {
    checkPatch(body.patch);
    describePatch(track, body.patch);
    writeFile(path.join(DATA, 'patches', `${track.id}.json`), JSON.stringify(body.patch));
  }
  if (body.image === '' || body.image === null) removeImage(track);
  else if (body.image !== undefined) saveImage(track, body.image);
  if (body.audio === '' || body.audio === null) removeAudio(track);
  else if (body.audio !== undefined) saveAudio(track, body.audio);
  track.updated = Date.now();
}

// ---- routes ----
async function api(req, res, url) {
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c] = parts;
  const m = req.method;

  if (a === 'tracks' && m === 'GET' && !b) return send(res, 200, readTracks().filter((t) => t.published).map(publicTrack));
  if (a === 'tracks' && m === 'GET' && c === 'patch') {
    const t = readTracks().find((x) => x.id === b && (x.published || authed(req)));
    const file = t && path.join(DATA, 'patches', `${t.id}.json`);
    if (!file || !fs.existsSync(file)) return fail(res, 404, 'No such track.');
    return send(res, 200, fs.readFileSync(file), 'application/json');
  }
  if (a === 'media' && b === 'images' && m === 'GET' && /^[a-z0-9-]+\.(jpg|png|webp)$/.test(c ?? '')) {
    const file = path.join(DATA, 'images', c);
    if (!fs.existsSync(file)) return fail(res, 404, 'No such image.');
    return send(res, 200, fs.readFileSync(file), MIME[c.split('.').pop()], { 'Cache-Control': 'public, max-age=31536000, immutable' });
  }
  if (a === 'media' && b === 'audio' && m === 'GET' && /^[a-z0-9-]+\.mp3$/.test(c ?? '')) {
    const file = path.join(DATA, 'audio', c);
    if (!fs.existsSync(file)) return fail(res, 404, 'No such audio.');
    return send(res, 200, fs.readFileSync(file), MIME.mp3, { 'Cache-Control': 'public, max-age=31536000, immutable' });
  }
  if (a === 'login' && m === 'POST') {
    const body = await readBody(req);
    if (!same(body.password ?? '', PASSWORD)) {
      await new Promise((r) => setTimeout(r, 700)); // slows password guessing down
      return fail(res, 401, 'Wrong password.');
    }
    return send(res, 200, { token: newToken(), hours: TOKEN_HOURS });
  }

  if (a === 'admin') {
    if (!authed(req)) return fail(res, 401, 'Please sign in again.');
    const list = readTracks();
    if (b === 'tracks' && m === 'GET' && !c) return send(res, 200, list.map(adminTrack));
    if (b === 'tracks' && m === 'POST' && !c) {
      const body = await readBody(req);
      if (body.patch === undefined) return fail(res, 400, 'Pick a patch file first.');
      const base = slug(body.title ?? body.patch?.name ?? 'track');
      let id = base;
      for (let n = 2; list.some((t) => t.id === id); n++) id = `${base}-${n}`;
      const track = { id, title: '', description: '', tags: [], published: true, image: null, audio: null, created: Date.now(), updated: Date.now() };
      applyFields(track, { title: body.patch?.name ?? '', description: body.patch?.description ?? '', ...body });
      list.push(track);
      writeTracks(list);
      return send(res, 201, adminTrack(track));
    }
    const track = b === 'tracks' && c ? list.find((t) => t.id === c) : null;
    if (b === 'tracks' && c && !track) return fail(res, 404, 'No such track.');
    if (track && m === 'PUT') {
      applyFields(track, await readBody(req));
      writeTracks(list);
      return send(res, 200, adminTrack(track));
    }
    if (track && m === 'DELETE') {
      removeImage(track);
      removeAudio(track);
      fs.rmSync(path.join(DATA, 'patches', `${track.id}.json`), { force: true });
      writeTracks(list.filter((t) => t !== track));
      return send(res, 200, { ok: true });
    }
  }
  return fail(res, 404, 'Not found.');
}

// `npm start` (SERVE_STATIC=1): also hand out the built pages, so one process runs the whole site
function serveStatic(res, url) {
  const dist = path.join(root, 'dist');
  let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist)) return fail(res, 403, 'No.');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return fail(res, 404, 'Not found.');
  return send(res, 200, fs.readFileSync(file), MIME[file.split('.').pop()] ?? 'application/octet-stream');
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') return await api(req, res, url);
    if (process.env.SERVE_STATIC) return serveStatic(res, url);
    return fail(res, 404, 'Not found.');
  } catch (e) {
    if (!e.status) console.error(e);
    return fail(res, e.status || 500, e.status ? e.message : 'Something went wrong on the server.');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`BonfireSTACK Tracks API on http://127.0.0.1:${PORT}  (data: ${DATA})`));
