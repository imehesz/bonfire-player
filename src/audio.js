// Plays a BonfireSTACK patch with the app's own engine (no rack on screen).
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

export function setVolume(v) {
  volume = v;
  eng?.setVolume(v);
}
export const play = async (raw) => (await loadEngine()).play(raw);
export const pause = () => eng?.pause();
export const resume = async () => (await loadEngine()).resume();
export const isPlaying = () => !!eng?.isPlaying();
export const onState = (fn) => (stateListeners.add(fn), () => stateListeners.delete(fn));
export const scope = () => eng?.scope() ?? null;

// Same link format as the app's own SHARE button: the whole patch, squeezed into the URL.
export async function openInAppUrl(raw) {
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  const packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let bin = '';
  for (const b of packed) bin += String.fromCharCode(b);
  return `${APP_URL}#p=${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
