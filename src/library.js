// What a listener keeps: liked tracks, their own playlists, the volume. All of it lives in this
// browser only (localStorage), nothing is sent anywhere.
const KEY = 'bonfirestack-tracks.v1';
const blank = () => ({ favorites: [], playlists: [], volume: 0.8, weakDismissed: false });

let data = blank();
try {
  data = { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch { /* private mode / broken JSON: start empty */ }

const listeners = new Set();
export const onLibrary = (fn) => (listeners.add(fn), () => listeners.delete(fn));
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch { /* storage full or blocked: keep going in memory */ }
  listeners.forEach((fn) => fn());
}

export const favorites = () => data.favorites;
export const isFavorite = (id) => data.favorites.includes(id);
export function toggleFavorite(id) {
  data.favorites = isFavorite(id) ? data.favorites.filter((x) => x !== id) : [...data.favorites, id];
  save();
  return isFavorite(id);
}

export const playlists = () => data.playlists;
export const playlist = (id) => data.playlists.find((p) => p.id === id) ?? null;
export function createPlaylist(name) {
  const p = { id: `pl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: String(name).trim().slice(0, 40) || 'Playlist', tracks: [] };
  data.playlists = [...data.playlists, p];
  save();
  return p;
}
export function renamePlaylist(id, name) {
  const p = playlist(id);
  if (!p) return;
  p.name = String(name).trim().slice(0, 40) || p.name;
  save();
}
export function deletePlaylist(id) {
  data.playlists = data.playlists.filter((p) => p.id !== id);
  save();
}
export function toggleInPlaylist(id, trackId) {
  const p = playlist(id);
  if (!p) return false;
  p.tracks = p.tracks.includes(trackId) ? p.tracks.filter((x) => x !== trackId) : [...p.tracks, trackId];
  save();
  return p.tracks.includes(trackId);
}

export const volume = () => data.volume;
export function setVolume(v) {
  data.volume = Math.min(1, Math.max(0, v));
  save();
}
export const weakDismissed = () => data.weakDismissed;
export function dismissWeak() {
  data.weakDismissed = true;
  save();
}
