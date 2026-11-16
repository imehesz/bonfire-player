// Admin page: sign in with the server's ADMIN_PASSWORD, then add / edit / delete tracks.
// A track = one BonfireSTACK patch file + title, description, tags, an optional ambiance image and an
// optional MP3 version (at most a minute; when there is one, the player plays it instead of the patch).
import { fill, h } from './dom.js';

const root = document.getElementById('admin');
const TOKEN_KEY = 'bonfirestack-tracks.admin';
const IMAGE_MAX = 1920; // px on the long side: big enough to fill a screen, small enough to load fast
const AUDIO_SECONDS = 60; // longest MP3 version
const AUDIO_BYTES = 3 * 1024 * 1024; // same cap as the server
let token = sessionStorage.getItem(TOKEN_KEY) || '';
let tracks = [];
let editing = null; // the track in the form, or null for a new one

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`api/${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') {
    token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    renderLogin('Please sign in again.');
    throw new Error('signed out');
  }
  if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
  return data;
}

// Shrinks a picture to IMAGE_MAX and re-saves it as a JPEG, in the browser, before upload.
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, IMAGE_MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}

// Checks an MP3 (size, that it decodes, at most AUDIO_SECONDS long) -> { dataUrl, seconds }.
async function readMp3(file) {
  if (!/\.mp3$/i.test(file.name) && !/^audio\/(mpeg|mp3)/.test(file.type)) throw new Error('pick an .mp3 file');
  if (file.size > AUDIO_BYTES) throw new Error(`it is ${(file.size / 1048576).toFixed(1)} MB, 3 MB at most`);
  const bytes = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  let seconds;
  try {
    seconds = (await new Promise((ok, bad) => ctx.decodeAudioData(bytes.slice(0), ok, bad))).duration;
  } catch {
    throw new Error('it could not be decoded as audio');
  } finally {
    ctx.close?.();
  }
  if (seconds > AUDIO_SECONDS + 0.5) throw new Error(`it is ${fmtTime(seconds)} long, ${AUDIO_SECONDS} seconds at most`);
  let bin = '';
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return { dataUrl: `data:audio/mpeg;base64,${btoa(bin)}`, seconds };
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function renderLogin(note = '') {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const msg = h('p', { class: `msg ${note ? 'bad' : ''}` }, note);
  fill(root, h('div', { class: 'card', style: { maxWidth: '420px', margin: '12vh auto 0' } },
    h('h2', {}, 'BonfireSTACK Tracks · admin'),
    h('form', { class: 'field', onsubmit: async (e) => {
      e.preventDefault();
      msg.className = 'msg';
      msg.textContent = 'Signing in…';
      try {
        token = (await api('login', { method: 'POST', body: { password: pw.value } })).token;
        sessionStorage.setItem(TOKEN_KEY, token);
        await load();
      } catch (err) {
        msg.className = 'msg bad';
        msg.textContent = err.message;
      }
    } },
    h('label', { class: 'field' }, h('span', {}, 'Password'), pw),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn solid', type: 'submit' }, 'Sign in')),
    msg)));
  pw.focus();
}

function renderForm() {
  const t = editing;
  let patch; // parsed patch file, when one was picked
  let image; // data: URL of a newly picked image; '' = remove the current one
  let audio; // data: URL of a newly picked MP3; '' = remove the current one
  const title = h('input', { type: 'text', value: t?.title ?? '', maxLength: 80, required: true });
  const desc = h('textarea', { maxLength: 600 }, t?.description ?? '');
  const tags = h('input', { type: 'text', value: (t?.tags ?? []).join(', '), placeholder: 'ambient, lo-fi, dub' });
  const published = h('input', { type: 'checkbox', checked: t ? t.published : true });
  const preview = h('img', { class: 'preview', alt: '', src: t?.image || 'default.jpg' });
  const msg = h('p', { class: 'msg' });
  const say = (text, bad = false) => {
    msg.textContent = text;
    msg.className = `msg ${bad ? 'bad' : ''}`;
  };
  const patchInput = h('input', { type: 'file', accept: '.json,application/json', onchange: async () => {
    patch = undefined;
    const f = patchInput.files[0];
    if (!f) return;
    try {
      patch = JSON.parse(await f.text());
      if (!Array.isArray(patch.modules)) throw new Error('no modules in it');
      if (!title.value.trim()) title.value = patch.name ?? f.name.replace(/\.bonfire\.json$|\.json$/, '');
      if (!desc.value.trim()) desc.value = patch.description ?? '';
      say(`Patch read: ${patch.modules.length} modules.${patch.localSounds?.length ? ' Careful: it uses samples that only exist on your computer.' : ''}`, !!patch.localSounds?.length);
    } catch (e) {
      patch = undefined;
      patchInput.value = '';
      say(`That doesn't look like a BonfireSTACK patch file (${e.message}).`, true);
    }
  } });
  const imageInput = h('input', { type: 'file', accept: 'image/*', onchange: async () => {
    const f = imageInput.files[0];
    if (!f) return;
    try {
      image = await shrinkImage(f);
      preview.src = image;
    } catch {
      imageInput.value = '';
      say('That image could not be read.', true);
    }
  } });
  const audioNote = h('small', {}, t?.audio ? 'This track has an MP3 version: the player plays that.' : 'No MP3: the player synthesizes the patch live.');
  const audioInput = h('input', { type: 'file', accept: '.mp3,audio/mpeg', onchange: async () => {
    audio = undefined;
    const f = audioInput.files[0];
    if (!f) return;
    audioNote.textContent = 'Checking the MP3…';
    try {
      const r = await readMp3(f);
      audio = r.dataUrl;
      audioNote.textContent = `MP3 ready: ${fmtTime(r.seconds)}, ${(f.size / 1048576).toFixed(1)} MB. It loops, so cut it to loop cleanly.`;
      say('');
    } catch (e) {
      audioInput.value = '';
      audioNote.textContent = t?.audio ? 'This track has an MP3 version: the player plays that.' : 'No MP3: the player synthesizes the patch live.';
      say(`That MP3 can't be used: ${e.message}.`, true);
    }
  } });
  const save = h('button', { class: 'btn solid', type: 'submit' }, t ? 'Save changes' : 'Add track');
  return h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    if (!t && !patch) return say('Pick a patch file first.', true);
    save.disabled = true;
    say('Saving…');
    const body = { title: title.value, description: desc.value, tags: tags.value, published: published.checked };
    if (patch) body.patch = patch;
    if (image !== undefined) body.image = image;
    if (audio !== undefined) body.audio = audio;
    try {
      await api(t ? `admin/tracks/${encodeURIComponent(t.id)}` : 'admin/tracks', { method: t ? 'PUT' : 'POST', body });
      editing = null;
      await load(t ? 'Saved.' : 'Track added.');
    } catch (err) {
      if (err.message !== 'signed out') say(err.message, true);
      save.disabled = false;
    }
  } },
  h('h2', {}, t ? `Edit “${t.title}”` : 'Add a track'),
  h('div', { class: 'form' },
    h('label', { class: 'field wide' }, h('span', {}, t ? 'Replace the patch (optional)' : 'Patch file'), patchInput,
      h('small', {}, 'The .bonfire.json you get from PATCH → Save in BonfireSTACK.')),
    h('label', { class: 'field' }, h('span', {}, 'Title'), title),
    h('label', { class: 'field' }, h('span', {}, 'Tags'), tags, h('small', {}, 'Separate with commas.')),
    h('label', { class: 'field wide' }, h('span', {}, 'Description'), desc),
    h('div', { class: 'field' }, h('span', {}, 'Ambiance image (optional)'), imageInput,
      h('small', {}, 'Wide pictures work best. Without one the default image is shown.'),
      t?.image ? h('div', { class: 'row-actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => {
        image = '';
        imageInput.value = '';
        preview.src = 'default.jpg';
      } }, 'Remove image')) : null),
    h('div', { class: 'field' }, h('span', {}, 'Preview'), preview),
    h('div', { class: 'field wide' }, h('span', {}, 'MP3 version (optional, 1 minute at most)'), audioInput, audioNote,
      h('small', {}, 'For busy patches that stutter when played live. Listeners hear the MP3 on a loop; OPEN IN BonfireSTACK still opens the patch.'),
      t?.audio ? h('div', { class: 'row-actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => {
        audio = '';
        audioInput.value = '';
        audioNote.textContent = 'The MP3 will be removed when you save: the player goes back to the live patch.';
      } }, 'Remove MP3')) : null),
    h('label', { class: 'check wide' }, published, h('span', {}, 'Published (untick to keep it as a draft only you can see here)'))),
  h('div', { class: 'row-actions', style: { marginTop: '16px' } }, save,
    t ? h('button', { class: 'btn', type: 'button', onclick: () => {
      editing = null;
      render();
    } }, 'Cancel') : null),
  msg);
}

function render(note = '') {
  fill(root, 
    h('div', { class: 'top' },
      h('div', {}, h('h1', {}, 'BonfireSTACK Tracks · admin'), h('a', { href: './' }, '← back to the site')),
      h('button', { class: 'btn', onclick: () => {
        token = '';
        sessionStorage.removeItem(TOKEN_KEY);
        renderLogin();
      } }, 'Sign out')),
    note ? h('p', { class: 'msg' }, note) : null,
    renderForm(),
    h('div', { class: 'card' },
      h('h2', {}, `Tracks (${tracks.length})`),
      tracks.length ? h('div', { class: 'tracks' }, tracks.map((t) => h('div', { class: 't-row' },
        h('img', { src: t.image || 'default.jpg', alt: '' }),
        h('div', {},
          h('h3', {}, t.title, t.published ? null : h('span', { class: 'badge' }, 'draft'), t.audio ? h('span', { class: 'badge' }, 'MP3') : null),
          h('p', {}, [t.tags.join(', ') || 'no tags', `${t.modules ?? '?'} modules`, `${t.bpm ?? '?'} BPM`, new Date(t.updated).toLocaleDateString()].join(' · ')),
          (t.warnings ?? []).map((w) => h('p', { class: 'warn-text' }, `⚠ ${w}`))),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn small', onclick: () => {
            editing = t;
            render();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } }, 'Edit'),
          h('a', { class: 'btn small', href: `./#t=${t.id}`, target: '_blank', rel: 'noopener' }, 'Listen'),
          h('button', { class: 'btn small danger', onclick: async () => {
            if (!confirm(`Delete “${t.title}” for good? Listeners lose it from their favorites and playlists too.`)) return;
            try {
              await api(`admin/tracks/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
              if (editing?.id === t.id) editing = null;
              await load('Track deleted.');
            } catch (err) {
              if (err.message !== 'signed out') render(err.message);
            }
          } }, 'Delete'))))) : h('p', { class: 'fine' }, 'No tracks yet. Add your first one above.')));
}

async function load(note = '') {
  tracks = (await api('admin/tracks')).sort((a, b) => b.created - a.created);
  render(note);
}

if (token) load().catch((e) => e.message !== 'signed out' && renderLogin(e.message));
else renderLogin();
