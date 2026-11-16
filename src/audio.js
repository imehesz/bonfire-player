// Plays a track: its MP3 version when it has one (busy patches can be too much for a small machine
// to synthesize live), otherwise the BonfireSTACK patch itself with the app's own engine (no rack).
// Where the engine comes from:
//   - normally: loaded at run time from the app itself, <APP_URL>engine.js, so the site always uses
//     the engine of the BonfireSTACK release that is live, with no rebuild of this site;
//   - while developing, or if that file can't be loaded (app offline, an app build from before
//     engine.js existed): the copy built into this site (src/engine-local.js).
export const APP_URL = import.meta.env.VITE_APP_URL || 'https://mehesz.net/bonfire/';
const REMOTE = import.meta.env.VITE_ENGINE === 'local' || (import.meta.env.DEV && import.meta.env.VITE_ENGINE !== 'remote') ? null : `${APP_URL}engine.js`;

let eng = null;
let source = 'not loaded';
let volume = 0.8;
const stateListeners = new Set();

async function loadRemote() {
  // version.txt changes on every app build: asking for engine.js?v=<it> gets past any cached copy
  const v = await fetch(`${APP_URL}version.txt`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  const mod = await import(/* @vite-ignore */ `${REMOTE}${v.trim() ? `?v=${encodeURIComponent(v.trim())}` : ''}`);
  if (typeof mod.play !== 'function') throw new Error('engine.js has no play()');
  return mod;
}

let loading = null;
// Loads the engine once. Safe to call early (page load) and again from play().
export function loadEngine() {
  return (loading ??= (async () => {
    if (REMOTE) {
      try {
        eng = await loadRemote();
        source = `app (${eng.VERSION ?? '?'})`;
      } catch (e) {
        console.warn('BonfireSTACK engine could not be loaded from the app, using the built-in copy:', e);
      }
    }
    if (!eng) {
      eng = await import('./engine-local.js');
      source = `built-in (${eng.VERSION ?? '?'})`;
    }
    eng.setVolume(volume);
    eng.onState((st) => stateListeners.forEach((fn) => fn(st)));
    return eng;
  })());
}

export const engineSource = () => source;

// ---- MP3 versions: decoded once, looped seamlessly by Web Audio (own context, gain and scope) ----
let mode = 'synth'; // which one isPlaying / pause / resume / scope talk to: 'synth' | 'file'
let fileCtx = null;
let fileGain = null;
let fileScope = null;
let fileSrc = null;
let filePlaying = false;
const fileBuffers = new Map(); // url -> Promise<AudioBuffer>, the last few tracks
const emit = (st = {}) => stateListeners.forEach((fn) => fn(st));

function fileGraph() {
  if (!fileCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    fileCtx = new AC();
    fileGain = fileCtx.createGain();
    fileGain.gain.value = volume;
    fileScope = fileCtx.createAnalyser();
    fileScope.fftSize = 2048;
    fileGain.connect(fileScope);
    fileScope.connect(fileCtx.destination);
  }
  return fileCtx;
}

// Call straight from the tap, before anything is awaited: phones only let audio start inside it.
export function unlockFile() {
  const c = fileGraph();
  if (c.state !== 'running') c.resume().catch(() => {});
}

function stopFile({ suspend = false } = {}) {
  if (fileSrc) {
    try {
      fileSrc.stop();
    } catch { /* never started */ }
    fileSrc.disconnect();
    fileSrc = null;
  }
  filePlaying = false;
  if (suspend && fileCtx?.state === 'running') fileCtx.suspend().catch(() => {});
}

function bufferOf(url) {
  if (!fileBuffers.has(url)) {
    const c = fileGraph();
    const p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`the MP3 did not load (${r.status})`);
        return r.arrayBuffer();
      })
      .then((b) => new Promise((ok, bad) => c.decodeAudioData(b, ok, () => bad(new Error('the MP3 could not be decoded')))));
    p.catch(() => fileBuffers.delete(url));
    fileBuffers.set(url, p);
    while (fileBuffers.size > 4) fileBuffers.delete(fileBuffers.keys().next().value);
  }
  return fileBuffers.get(url);
}

export async function playFile(url) {
  unlockFile();
  const buf = await bufferOf(url);
  eng?.pause(); // the live synth stops
  stopFile();
  mode = 'file';
  const src = fileCtx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(fileGain);
  src.start();
  fileSrc = src;
  await fileCtx.resume();
  filePlaying = true;
  emit();
  return { warnings: [] };
}

export function setVolume(v) {
  volume = v;
  eng?.setVolume(v);
  if (fileGain) fileGain.gain.value = v;
}
export const play = async (raw) => {
  const e = await loadEngine();
  stopFile({ suspend: true });
  mode = 'synth';
  return e.play(raw);
};
export const pause = () => {
  if (mode === 'synth') return eng?.pause();
  fileCtx?.suspend().catch(() => {});
  filePlaying = false;
  emit();
};
export const resume = async () => {
  if (mode === 'synth') return (await loadEngine()).resume();
  const r = fileCtx.resume(); // called first, still inside the tap
  filePlaying = true;
  emit();
  await r;
};
export const isPlaying = () => (mode === 'file' ? filePlaying : !!eng?.isPlaying());
export const onState = (fn) => (stateListeners.add(fn), () => stateListeners.delete(fn));
export const scope = () => (mode === 'file' ? fileScope : eng?.scope() ?? null);

// Same link format as the app's own SHARE button: the whole patch, squeezed into the URL.
export async function openInAppUrl(raw) {
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  const packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let bin = '';
  for (const b of packed) bin += String.fromCharCode(b);
  return `${APP_URL}#p=${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
