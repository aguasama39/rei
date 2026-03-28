// library-store.js — persistent library data
// Stores: named playlists, play counts, favorites (stars), color labels, BPM cache, queue

const DEFAULT = {
  version: 2,
  playlists: { default: { name: 'Default', tracks: [] } },
  trackMeta: {},   // filePath → { playCount, lastPlayed, bpm, star, label }
  queue: [],       // "play next" queue (filePaths)
  activePlaylistId: 'default',
};

export let data = JSON.parse(JSON.stringify(DEFAULT));

// ── Load / save ───────────────────────────────────────────────────────────────

export async function loadLibrary() {
  const saved = await window.api.loadLibraryData();
  if (saved) {
    data = { ...DEFAULT, ...saved };
    if (!data.playlists)               data.playlists = JSON.parse(JSON.stringify(DEFAULT.playlists));
    if (!data.playlists.default)       data.playlists.default = { name: 'Default', tracks: [] };
    if (!data.trackMeta)               data.trackMeta = {};
    if (!Array.isArray(data.queue))    data.queue = [];
    if (!data.activePlaylistId)        data.activePlaylistId = 'default';
  }
}

let _saveTimer = null;
export function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => window.api.saveLibraryData(data), 500);
}

// ── Track meta helpers ────────────────────────────────────────────────────────

function _meta(fp) {
  if (!data.trackMeta[fp]) {
    data.trackMeta[fp] = { playCount: 0, lastPlayed: null, bpm: null, star: false, label: null };
  }
  return data.trackMeta[fp];
}

export const isStar      = fp => !!_meta(fp).star;
export const getLabel    = fp => _meta(fp).label ?? null;
export const getPlayCount = fp => _meta(fp).playCount || 0;
export const getBPM      = fp => _meta(fp).bpm ?? null;

export function toggleStar(fp) {
  const m = _meta(fp);
  m.star = !m.star;
  scheduleSave();
  return m.star;
}

export function setLabel(fp, color) {
  _meta(fp).label = color || null;
  scheduleSave();
}

export function recordPlay(fp) {
  const m = _meta(fp);
  m.playCount = (m.playCount || 0) + 1;
  m.lastPlayed = Date.now();
  scheduleSave();
}

export function setBPM(fp, bpm) {
  _meta(fp).bpm = bpm;
  scheduleSave();
}

// ── Named playlists ───────────────────────────────────────────────────────────

export const getPlaylists   = () => data.playlists;
export const getActiveId    = () => data.activePlaylistId;

export function setActivePlaylist(id) {
  data.activePlaylistId = id;
  scheduleSave();
}

export function createPlaylist(name) {
  const id = 'pl-' + Date.now();
  data.playlists[id] = { name, tracks: [] };
  scheduleSave();
  return id;
}

export function deletePlaylist(id) {
  if (id === 'default') return;
  delete data.playlists[id];
  if (data.activePlaylistId === id) data.activePlaylistId = 'default';
  scheduleSave();
}

export function renamePlaylist(id, name) {
  if (data.playlists[id]) { data.playlists[id].name = name; scheduleSave(); }
}

export function addToPlaylist(id, fp) {
  const pl = data.playlists[id];
  if (pl && !pl.tracks.includes(fp)) { pl.tracks.push(fp); scheduleSave(); }
}

export function removeFromPlaylist(id, fp) {
  const pl = data.playlists[id];
  if (pl) { pl.tracks = pl.tracks.filter(p => p !== fp); scheduleSave(); }
}

export function setPlaylistTracks(id, tracks) {
  if (data.playlists[id]) { data.playlists[id].tracks = tracks; scheduleSave(); }
}

// ── Auto-playlists (virtual — computed from trackMeta) ────────────────────────

export const AUTO = {
  FAVORITES: '__fav__',
  RECENT:    '__recent__',
  MOST:      '__most__',
};

export const AUTO_NAMES = {
  [AUTO.FAVORITES]: '⭐ Favorites',
  [AUTO.RECENT]:    '🕐 Recently Played',
  [AUTO.MOST]:      '🔥 Most Played',
};

export function getAutoTracks(id, allTracks) {
  const m = data.trackMeta;
  if (id === AUTO.FAVORITES)
    return allTracks.filter(t => m[t.filePath]?.star);
  if (id === AUTO.RECENT)
    return [...allTracks]
      .filter(t => m[t.filePath]?.lastPlayed)
      .sort((a, b) => (m[b.filePath]?.lastPlayed || 0) - (m[a.filePath]?.lastPlayed || 0))
      .slice(0, 50);
  if (id === AUTO.MOST)
    return [...allTracks]
      .filter(t => (m[t.filePath]?.playCount || 0) > 0)
      .sort((a, b) => (m[b.filePath]?.playCount || 0) - (m[a.filePath]?.playCount || 0))
      .slice(0, 50);
  return allTracks;
}

// ── Queue (play next) ─────────────────────────────────────────────────────────

export const getQueue  = () => [...data.queue];

export function enqueueNext(fp) {
  // Put at front of queue
  data.queue = [fp, ...data.queue.filter(p => p !== fp)];
  scheduleSave();
}

export function dequeue() {
  const fp = data.queue.shift() ?? null;
  scheduleSave();
  return fp;
}

export function removeFromQueue(fp) {
  data.queue = data.queue.filter(p => p !== fp);
  scheduleSave();
}

export function clearQueue() {
  data.queue = [];
  scheduleSave();
}
