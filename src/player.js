// BonfireSTACK Tracks: the listening page.
// Left: playlists (All tracks, Favorites, your own) and tags. Middle: the selected track over its
// ambiance image. Right: search + the track list for the chosen playlist / tag. Bottom: transport.
import * as audio from './audio.js';
import * as lib from './library.js';
import { fill, h, sheet, toast } from './dom.js';

const DEFAULT_IMAGE = 'default.jpg';
const app = document.getElementById('app');

let tracks = []; // from the API, newest first
const patches = new Map(); // track id -> patch JSON (fetched on first play)
const view = { list: 'all', tag: null, q: '' }; // list: 'all' | 'fav' | <playlist id>
let currentId = null; // the track shown in the middle
let loadedId = null; // the track the engine has loaded
let queue = []; // ids of the list the current track was started from (for next / previous)
let busy = false;
let playedFor = 0; // seconds the current track has actually been playing (pauses don't count)
const LOOP_STEPS = [0, 30, 60, 120, 300]; // 0 = non-stop

const byId = (id) => tracks.find((t) => t.id === id) ?? null;
const imageOf = (t) => t?.image || DEFAULT_IMAGE;

// ---------------- data ----------------
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status} ${r.statusText}`);
  return r.json();
}

async function patchOf(id) {
  if (!patches.has(id)) patches.set(id, await fetchJson(`api/tracks/${encodeURIComponent(id)}/patch`));
  return patches.get(id);
}

function visibleTracks() {
  let list = tracks;
  if (view.list === 'fav') list = lib.favorites().map(byId).filter(Boolean);
  else if (view.list !== 'all') list = (lib.playlist(view.list)?.tracks ?? []).map(byId).filter(Boolean);
  if (view.tag) list = list.filter((t) => t.tags.includes(view.tag));
  const q = view.q.trim().toLowerCase();
  if (q) list = list.filter((t) => `${t.title} ${t.tags.join(' ')} ${t.description}`.toLowerCase().includes(q));
  return list;
}

// ---------------- playback ----------------
async function playTrack(id, { fromList = true } = {}) {
  const t = byId(id);
  if (!t || busy) return;
  busy = true;
  if (fromList) queue = visibleTracks().map((x) => x.id);
  if (!queue.includes(id)) queue = [id, ...queue];
  select(id);
  setLoading(true);
  try {
    const { warnings } = await audio.play(await patchOf(id));
    loadedId = id;
    playedFor = 0;
    for (const w of warnings) toast(w, 'warn');
  } catch (e) {
    loadedId = null;
    toast(`Couldn't play “${t.title}”: ${e.message}`, 'warn');
  }
  busy = false;
  setLoading(false);
  renderTransport();
  renderList();
  mediaSession(t);
}

async function togglePlay() {
  if (busy) return;
  if (audio.isPlaying()) return audio.pause();
  if (loadedId && loadedId === currentId) return audio.resume();
  const id = currentId ?? visibleTracks()[0]?.id;
  if (id) return playTrack(id);
}

function step(dir) {
  const list = queue.length ? queue : visibleTracks().map((t) => t.id);
  if (!list.length) return;
  const i = list.indexOf(currentId);
  playTrack(list[(i + dir + list.length) % list.length], { fromList: false });
}

// LOOP button: how long a track plays before moving on to the next one
const REPEAT_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>';
const loopLabel = (sec) => (sec === 0 ? 'Non-stop' : sec < 60 ? `${sec} seconds` : `${sec / 60} minute${sec > 60 ? 's' : ''}`);
function cycleLoop() {
  const i = LOOP_STEPS.indexOf(lib.loopFor());
  lib.setLoopFor(LOOP_STEPS[(i + 1) % LOOP_STEPS.length]);
  playedFor = 0; // a fresh choice counts from now
  renderLoop();
  renderProgress();
  toast(lib.loopFor() ? `Each track plays for ${loopLabel(lib.loopFor())}, then the next one starts` : 'Non-stop: the track loops until you change it');
}
function renderLoop() {
  const sec = lib.loopFor();
  loopBtn.classList.toggle('timed', sec > 0);
  if (sec === 0) loopBtn.innerHTML = REPEAT_SVG;
  else loopBtn.textContent = sec < 60 ? `${sec}s` : `${sec / 60}m`;
  loopBtn.title = `Play each track: ${loopLabel(sec)} (tap to change)`;
  loopBtn.setAttribute('aria-label', loopBtn.title);
}
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  const limit = lib.loopFor();
  if (limit && !busy && loadedId && audio.isPlaying()) {
    playedFor += dt;
    if (playedFor >= limit) {
      playedFor = 0;
      step(1);
    }
  }
  renderProgress();
}, 250);

// thin line along the top of the transport bar: how much of the timed play is used up (hidden when non-stop)
let lastFrac = 0;
function renderProgress() {
  const limit = lib.loopFor();
  progress.hidden = !limit || !loadedId;
  const frac = limit ? Math.min(1, playedFor / limit) : 0;
  progress.firstChild.style.transition = frac < lastFrac ? 'none' : ''; // snap back on a new track, glide forward otherwise
  progress.firstChild.style.transform = `scaleX(${frac})`;
  lastFrac = frac;
}

function mediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: 'BonfireSTACK', artwork: [{ src: new URL(imageOf(t), location.href).href }] });
  navigator.mediaSession.setActionHandler('play', togglePlay);
  navigator.mediaSession.setActionHandler('pause', togglePlay);
  navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
}

// ---------------- layout ----------------
const bg = h('div', { class: 'bg' });
const bgNext = h('div', { class: 'bg next' });
const sidebar = h('aside', { class: 'sidebar' });
const hero = h('section', { class: 'hero' });
const listBox = h('div', { class: 'track-list' });
const search = h('input', {
  class: 'search', type: 'search', placeholder: 'Search tracks', 'aria-label': 'Search tracks',
  oninput: () => {
    view.q = search.value;
    renderList();
  },
});
const listTitle = h('div', { class: 'list-title' });
const panel = h('section', { class: 'panel' }, h('div', { class: 'search-wrap' }, search, h('span', { class: 'search-icon', 'aria-hidden': 'true' }, '⌕')), listTitle, listBox);
const playBtn = h('button', { class: 'round big', 'aria-label': 'Play', onclick: togglePlay });
const loopBtn = h('button', { class: 'round loop', onclick: cycleLoop });
const progress = h('div', { class: 'progress', hidden: true, 'aria-hidden': 'true' }, h('div', { class: 'progress-fill' }));
const scopeCanvas = h('canvas', { class: 'scope', width: 900, height: 96 });
const volume = h('input', {
  class: 'volume', type: 'range', min: 0, max: 1, step: 0.01, value: lib.volume(), 'aria-label': 'Volume',
  oninput: () => {
    audio.setVolume(Number(volume.value));
    lib.setVolume(Number(volume.value));
  },
});
const nowPlaying = h('div', { class: 'now' });
const transport = h('footer', { class: 'transport' },
  progress,
  nowPlaying,
  h('div', { class: 'buttons' },
    loopBtn,
    h('button', { class: 'round', 'aria-label': 'Previous track', onclick: () => step(-1) }, '⏮'),
    playBtn,
    h('button', { class: 'round', 'aria-label': 'Next track', onclick: () => step(1) }, '⏭')),
  scopeCanvas,
  h('label', { class: 'vol' }, h('span', { 'aria-hidden': 'true' }, '🔈'), volume));
const notice = h('div', { class: 'notice', hidden: true });

app.append(bg, bgNext, sidebar, h('main', { class: 'stage' }, notice, hero, panel), transport);

function setLoading(on) {
  playBtn.classList.toggle('loading', on);
}

// ---------------- sidebar ----------------
function setList(id) {
  view.list = id;
  renderSidebar();
  renderList();
}

function playlistMenu(p) {
  const close = sheet(p.name, h('div', { class: 'menu' },
    h('button', { class: 'menu-item', onclick: () => {
      const name = prompt('Playlist name', p.name);
      if (name?.trim()) lib.renamePlaylist(p.id, name);
      close();
    } }, 'Rename'),
    h('button', { class: 'menu-item danger', onclick: () => {
      if (!confirm(`Delete the playlist “${p.name}”? The tracks themselves stay.`)) return;
      if (view.list === p.id) view.list = 'all';
      lib.deletePlaylist(p.id);
      close();
    } }, 'Delete playlist')));
}

function newPlaylist(thenAdd) {
  const name = prompt('Name your playlist');
  if (!name?.trim()) return null;
  const p = lib.createPlaylist(name);
  if (thenAdd) lib.toggleInPlaylist(p.id, thenAdd);
  return p;
}

function renderSidebar() {
  const allTags = [...new Set(tracks.flatMap((t) => t.tags))].sort();
  const row = (id, label, count, extra) => h('div', { class: `pl-row ${view.list === id ? 'on' : ''}` },
    h('button', { class: 'pl-name', onclick: () => setList(id) }, h('span', {}, label), h('em', {}, count)),
    extra);
  fill(sidebar, 
    h('a', { class: 'logo', href: './', 'aria-label': 'BonfireSTACK Tracks' }, h('img', { src: 'logo.png', alt: 'BonfireSTACK' }), h('span', {}, 'TRACKS')),
    h('h3', {}, 'Playlists'),
    h('nav', { class: 'playlists' },
      row('all', 'All tracks', tracks.length),
      row('fav', '♥ Favorites', lib.favorites().filter(byId).length),
      lib.playlists().map((p) => row(p.id, p.name, p.tracks.filter(byId).length,
        h('button', { class: 'icon-btn', 'aria-label': `Options for ${p.name}`, onclick: () => playlistMenu(p) }, '⋯'))),
      h('button', { class: 'pl-new', onclick: () => {
        const p = newPlaylist();
        if (p) setList(p.id);
      } }, '+ New playlist')),
    allTags.length ? h('h3', {}, 'Tags') : null,
    h('div', { class: 'tags' }, allTags.map((tag) => h('button', {
      class: `chip ${view.tag === tag ? 'on' : ''}`,
      onclick: () => {
        view.tag = view.tag === tag ? null : tag;
        renderSidebar();
        renderList();
      },
    }, tag))),
    h('p', { class: 'fine' }, 'Favorites and playlists are saved in this browser only.'),
    h('p', { class: 'fine engine' }, `Engine: ${audio.engineSource()}`));
}

// ---------------- hero ----------------
function setBackground(src) {
  if (bg.dataset.src === src) return;
  bg.dataset.src = src;
  bgNext.style.backgroundImage = `url("${src}")`;
  bgNext.classList.add('show');
  setTimeout(() => {
    bg.style.backgroundImage = `url("${src}")`;
    bgNext.classList.remove('show');
  }, 600);
}

function addToPlaylistSheet(t) {
  const body = h('div', { class: 'menu' });
  const draw = () => fill(body,
    lib.playlists().map((p) => h('button', { class: 'menu-item check', onclick: () => {
      lib.toggleInPlaylist(p.id, t.id);
      draw();
    } }, h('span', { class: 'box' }, p.tracks.includes(t.id) ? '✓' : ''), p.name)),
    lib.playlists().length ? null : h('p', { class: 'fine' }, 'You have no playlists yet.'),
    h('button', { class: 'menu-item accent', onclick: () => {
      if (newPlaylist(t.id)) draw();
    } }, '+ New playlist'));
  draw();
  sheet(`Add “${t.title}” to…`, body);
}

function select(id) {
  currentId = id;
  history.replaceState(null, '', `#t=${id}`);
  renderHero();
  renderList();
}

function renderHero() {
  const t = byId(currentId);
  if (!t) {
    setBackground(DEFAULT_IMAGE);
    fill(hero, h('h1', {}, tracks.length ? 'Pick a track' : 'No tracks yet'),
      h('p', { class: 'desc' }, tracks.length ? 'Choose something from the list to start listening.' : 'Come back soon: the first tracks are on their way.'));
    return;
  }
  setBackground(imageOf(t));
  const fav = lib.isFavorite(t.id);
  const open = h('a', { class: 'btn outline', target: '_blank', rel: 'noopener', href: audio.APP_URL }, 'OPEN IN BonfireSTACK');
  // the real link carries the whole patch; until it is fetched the button just opens the app
  patchOf(t.id).then(audio.openInAppUrl).then((url) => (open.href = url)).catch(() => {});
  fill(hero, 
    h('h1', {}, t.title),
    h('div', { class: 'tags row' }, t.tags.map((tag) => h('span', { class: 'chip static' }, tag))),
    t.description ? h('p', { class: 'desc' }, t.description) : null,
    h('div', { class: 'actions' },
      h('button', { class: `btn heart ${fav ? 'on' : ''}`, 'aria-pressed': String(fav), onclick: () => lib.toggleFavorite(t.id) }, fav ? '♥ Liked' : '♡ Like'),
      h('button', { class: 'btn', onclick: () => addToPlaylistSheet(t) }, '+ Playlist'),
      open));
}

// ---------------- track list ----------------
function listName() {
  if (view.list === 'all') return 'All tracks';
  if (view.list === 'fav') return 'Favorites';
  return lib.playlist(view.list)?.name ?? 'Playlist';
}

function renderList() {
  const list = visibleTracks();
  fill(listTitle, h('span', {}, listName()), view.tag ? h('button', { class: 'chip on', onclick: () => {
    view.tag = null;
    renderSidebar();
    renderList();
  } }, `${view.tag} ✕`) : null, h('em', {}, `${list.length} ${list.length === 1 ? 'track' : 'tracks'}`));
  if (!list.length) {
    const why = view.q.trim() || view.tag ? 'Nothing matches that. Try another search or tag.'
      : view.list === 'fav' ? 'Nothing here yet. Tap the ♡ on a track to keep it in Favorites.'
        : view.list !== 'all' ? 'This playlist is empty. Open a track and use “+ Playlist” to add it.'
          : 'No tracks yet.';
    fill(listBox, h('p', { class: 'empty' }, why));
    return;
  }
  fill(listBox, list.map((t) => {
    const fav = lib.isFavorite(t.id);
    const playing = t.id === loadedId && audio.isPlaying();
    return h('div', { class: `track ${t.id === currentId ? 'on' : ''} ${playing ? 'playing' : ''}` },
      h('button', { class: 'track-main', onclick: () => playTrack(t.id), 'aria-label': `Play ${t.title}` },
        h('img', { class: 'thumb', src: imageOf(t), alt: '', loading: 'lazy' }),
        h('span', { class: 'track-text' },
          h('span', { class: 'track-title' }, t.title, playing ? h('i', { class: 'eq', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')) : null),
          h('span', { class: 'tags row' }, t.tags.map((tag) => h('span', { class: 'chip static small' }, tag))))),
      h('button', { class: `heart-btn ${fav ? 'on' : ''}`, 'aria-label': fav ? `Unlike ${t.title}` : `Like ${t.title}`, 'aria-pressed': String(fav), onclick: () => lib.toggleFavorite(t.id) }, fav ? '♥' : '♡'));
  }));
}

// ---------------- transport ----------------
function renderTransport() {
  const playing = audio.isPlaying();
  playBtn.textContent = playing ? '⏸' : '▶';
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  const t = byId(loadedId ?? currentId);
  fill(nowPlaying, t ? [h('img', { src: imageOf(t), alt: '' }), h('span', {}, t.title)] : []);
  document.title = playing && t ? `${t.title} - BonfireSTACK` : 'BonfireSTACK Tracks';
}

// bars from the live waveform, like a little oscilloscope; a flat dotted line while silent
function drawScope() {
  const g = scopeCanvas.getContext('2d');
  const { width: w, height: ht } = scopeCanvas;
  const an = audio.isPlaying() ? audio.scope() : null;
  const bars = 110;
  g.clearRect(0, 0, w, ht);
  g.fillStyle = '#ffb066';
  let data = null;
  if (an) {
    data = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(data);
  }
  for (let i = 0; i < bars; i++) {
    let v = 0;
    if (data) {
      const a = Math.floor((i / bars) * data.length);
      const b = Math.floor(((i + 1) / bars) * data.length);
      for (let k = a; k < b; k++) v = Math.max(v, Math.abs(data[k]));
    }
    const hh = Math.max(2, Math.min(1, v * 2.2) * (ht - 6));
    g.globalAlpha = data ? 0.55 + 0.45 * Math.min(1, v * 3) : 0.25;
    g.fillRect((i / bars) * w + 1, (ht - hh) / 2, w / bars - 3, hh);
  }
  requestAnimationFrame(drawScope);
}

// ---------------- weak machines ----------------
// Tracks are made of live synthesis, not recordings, so a small machine can run out of breath.
function weakDevice() {
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8; // not reported by every browser
  return cores <= 4 || mem <= 4;
}

function showNotice() {
  if (lib.weakDismissed() || !weakDevice()) return;
  notice.hidden = false;
  fill(notice, 
    h('span', {}, 'Heads up: tracks here are played live by your browser, not streamed as recordings. On this device the busier ones may crackle or stutter.'),
    h('button', { class: 'btn small', onclick: () => {
      lib.dismissWeak();
      notice.hidden = true;
    } }, 'Got it'));
}

// ---------------- keep the screen on while playing ----------------
// Phones throttle a page whose screen went dark, and the live synthesis stops with it. The Screen
// Wake Lock API keeps the screen on while a track plays (HTTPS only; the browser drops the lock
// whenever the tab is hidden, so it is asked for again when the tab comes back).
let wakeLock = null;
async function syncWakeLock() {
  if (!('wakeLock' in navigator)) return;
  const want = audio.isPlaying() && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* refused (battery saver, not visible...): nothing else to do */ }
}
document.addEventListener('visibilitychange', syncWakeLock);

// ---------------- boot ----------------
audio.setVolume(lib.volume());
audio.onState((st) => {
  renderTransport();
  renderList();
  syncWakeLock();
  if (st.error) toast(`Playback problem: ${st.error}`, 'warn');
});
lib.onLibrary(() => {
  renderSidebar();
  renderHero();
  renderList();
});
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || /INPUT|TEXTAREA|BUTTON|A/.test(document.activeElement?.tagName ?? '')) return;
  e.preventDefault();
  togglePlay();
});

(async () => {
  audio.loadEngine().then(renderSidebar, () => {}); // in the background: ready by the first click
  renderSidebar();
  renderHero();
  renderList();
  renderTransport();
  renderLoop();
  drawScope();
  showNotice();
  try {
    tracks = (await fetchJson('api/tracks')).sort((a, b) => b.created - a.created);
  } catch (e) {
    toast(`Couldn't load the track list: ${e.message}`, 'warn');
  }
  const wanted = /#t=([\w-]+)/.exec(location.hash)?.[1];
  currentId = byId(wanted)?.id ?? tracks[0]?.id ?? null;
  renderSidebar();
  renderHero();
  renderList();
  renderTransport();
})();
