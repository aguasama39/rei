// renderer.js — main entry module (type="module")
// Imports Web Audio engine, library store, and lyrics helpers.

import { initAudioEngine, resumeCtx, fadeGain, getFrequencyData,
         getPrimaryGain, getSecondaryGain } from './audio-engine.js';
import { loadLibrary, scheduleSave, data as lib,
         isStar, toggleStar, getLabel, setLabel, recordPlay, getBPM, setBPM,
         getPlaylists, getActiveId, setActivePlaylist, createPlaylist,
         deletePlaylist, renamePlaylist, addToPlaylist, removeFromPlaylist,
         setPlaylistTracks, AUTO, AUTO_NAMES, getAutoTracks,
         getQueue, enqueueNext, dequeue, removeFromQueue, clearQueue } from './library-store.js';
import { parseLRC, getCurrentLyricIdx } from './lyrics.js';

// ── Audio elements ────────────────────────────────────────────────────────────
const audio  = document.getElementById('audio');
const audioB = document.getElementById('audio-b');

// Crossfade state: which element is currently "primary"
let cf = {
  cur: audio, next: audioB,
  curGain: null, nextGain: null,  // set after engine init
  active: false,
};

// ── Playback state ────────────────────────────────────────────────────────────
let playlist     = [];   // metadata objects for active playlist
let allTracks    = [];   // union of all named playlist tracks (for browse / auto-playlists)
let currentIndex = -1;
let shuffleOn    = false;
let shuffleOrder = [];
let repeatMode   = 'none'; // 'none' | 'all' | 'one'
let isSeeking    = false;
let crossfadeDur = 0;
let cfStarted    = false;
let miniOpen     = false;

// ── Lyrics state ──────────────────────────────────────────────────────────────
let currentLyrics  = [];
let lastLyricIdx   = -1;

// ── BPM worker ────────────────────────────────────────────────────────────────
const bpmWorker   = new Worker('./bpm-worker.js');
const bpmCallbacks = new Map(); // id → resolve
let   bpmReqId    = 0;
bpmWorker.onmessage = ({ data: { id, bpm } }) => {
  const fp = bpmCallbacks.get(id);
  if (fp) { bpmCallbacks.delete(id); onBPMResult(fp, bpm); }
};
function requestBPM(filePath) {
  const id = ++bpmReqId;
  bpmCallbacks.set(id, filePath);
  bpmWorker.postMessage({ id, filePath });
}
function onBPMResult(fp, bpm) {
  if (bpm) {
    setBPM(fp, bpm);
    if (playlist[currentIndex]?.filePath === fp) updateBPMDisplay(bpm);
  }
}

// ── Visualiser ────────────────────────────────────────────────────────────────
const vizCanvas  = document.getElementById('visualizer');
const vizCtx     = vizCanvas.getContext('2d');
let   vizEnabled = false;
let   vizRafId   = null;

function drawVisualizer() {
  if (!vizEnabled) return;
  vizRafId = requestAnimationFrame(drawVisualizer);
  const data = getFrequencyData();
  if (!data) return;

  const W = vizCanvas.width, H = vizCanvas.height;
  vizCtx.clearRect(0, 0, W, H);

  const barW = W / (data.length / 2.5);
  const count = Math.floor(W / (barW + 1));
  for (let i = 0; i < count; i++) {
    const v  = data[Math.floor(i * data.length / count)] / 255;
    const h  = v * H;
    const hue = 200 + v * 40;
    vizCtx.fillStyle = `hsl(${hue},80%,55%)`;
    vizCtx.fillRect(i * (barW + 1), H - h, barW, h);
  }
}

function resizeViz() {
  vizCanvas.width = vizCanvas.offsetWidth;
}

// ── Sleep timer ───────────────────────────────────────────────────────────────
let sleepEnd = null;
let sleepInterval = null;
const sleepDisplay    = document.getElementById('sleep-display');
const sleepCountdown  = document.getElementById('sleep-countdown');

function setSleepTimer(minutes) {
  clearInterval(sleepInterval);
  if (!minutes) { sleepEnd = null; sleepDisplay.classList.add('hidden'); return; }
  sleepEnd = Date.now() + minutes * 60_000;
  sleepInterval = setInterval(tickSleep, 1000);
  sleepDisplay.classList.remove('hidden');
  tickSleep();
}

function tickSleep() {
  if (!sleepEnd) return;
  const rem = sleepEnd - Date.now();
  if (rem <= 0) {
    clearInterval(sleepInterval);
    sleepEnd = null; sleepDisplay.classList.add('hidden');
    fadeGain(getPrimaryGain(), 0, 2, () => { audio.pause(); setPlayIcon(false); });
    return;
  }
  const m = Math.floor(rem / 60_000), s = Math.floor((rem % 60_000) / 1000);
  sleepCountdown.textContent = `${m}:${s.toString().padStart(2,'0')}`;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const albumArtEl    = document.getElementById('album-art');
const artPlaceholder= document.getElementById('art-placeholder');
const trackTitle    = document.getElementById('track-title');
const trackArtist   = document.getElementById('track-artist');
const trackMeta     = document.getElementById('track-meta');
const seekBar       = document.getElementById('seek-bar');
const timeCurrent   = document.getElementById('time-current');
const timeTotal     = document.getElementById('time-total');
const volumeBar     = document.getElementById('volume-bar');
const speedBar      = document.getElementById('speed-bar');
const speedLabel    = document.getElementById('speed-label');
const btnPlay       = document.getElementById('btn-play');
const iconPlay      = btnPlay.querySelector('.icon-play');
const iconPause     = btnPlay.querySelector('.icon-pause');
const btnRepeat     = document.getElementById('btn-repeat');
const btnShuffle    = document.getElementById('btn-shuffle');
const btnStar       = document.getElementById('btn-star');
const labelDot      = document.getElementById('label-dot');
const bpmBadge      = document.getElementById('bpm-badge');
const playlistEl    = document.getElementById('playlist');
const searchInput   = document.getElementById('search-input');
const sortSelect    = document.getElementById('sort-select');
const activePlName  = document.getElementById('active-pl-name');
const lyricsPanel   = document.getElementById('lyrics-panel');
const lyricsInner   = document.getElementById('lyrics-inner');
const ctxMenu       = document.getElementById('ctx-menu');
const tagModal      = document.getElementById('tag-modal');
const dupesModal    = document.getElementById('dupes-modal');
const queueList     = document.getElementById('queue-list');
const queueCount    = document.getElementById('queue-count');
const browseContent = document.getElementById('browse-content');
const playlistsEl   = document.getElementById('playlists-list');
const sleepDropdown = document.getElementById('sleep-dropdown');

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setPlayIcon(playing) {
  iconPlay.style.display  = playing ? 'none'  : 'block';
  iconPause.style.display = playing ? 'block' : 'none';
}

// ── Dynamic background from album art ────────────────────────────────────────
const _offCanvas = document.createElement('canvas');
_offCanvas.width = _offCanvas.height = 16;
const _offCtx = _offCanvas.getContext('2d');

function applyDynamicBg(albumArtSrc) {
  if (!albumArtSrc) {
    document.querySelector('.main-panel').style.background = '';
    return;
  }
  const img = new Image();
  img.onload = () => {
    _offCtx.drawImage(img, 0, 0, 16, 16);
    const px = _offCtx.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i+1]; b += px[i+2]; }
    const n = px.length / 4;
    r = Math.round(r/n); g = Math.round(g/n); b = Math.round(b/n);
    document.querySelector('.main-panel').style.background =
      `linear-gradient(to bottom, rgba(${r},${g},${b},0.22) 0%, #121212 55%)`;
  };
  img.src = albumArtSrc;
}

// ── Search ────────────────────────────────────────────────────────────────────
let searchQuery = '';
searchInput.addEventListener('input', () => { searchQuery = searchInput.value.toLowerCase(); renderPlaylist(); });

// ── Sort ──────────────────────────────────────────────────────────────────────
function sortPlaylist() {
  const cur = currentIndex >= 0 ? playlist[currentIndex] : null;
  const key = sortSelect.value;
  playlist.sort((a, b) => {
    if (key === 'title')    return a.title.localeCompare(b.title);
    if (key === 'album')    return a.album.localeCompare(b.album) || (a.track||0)-(b.track||0);
    if (key === 'duration') return (a.duration||0) - (b.duration||0);
    if (key === 'bpm')      return (getBPM(b.filePath)||0) - (getBPM(a.filePath)||0);
    // default: artist
    return a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || (a.track||0)-(b.track||0) || a.title.localeCompare(b.title);
  });
  if (cur) currentIndex = playlist.indexOf(cur);
  rebuildShuffleOrder();
}

sortSelect.addEventListener('change', () => { sortPlaylist(); renderPlaylist(); persistActivePlaylist(); });

// ── Shuffle order ─────────────────────────────────────────────────────────────
function rebuildShuffleOrder() {
  shuffleOrder = playlist.map((_, i) => i);
  for (let i = shuffleOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
  }
}

// ── Playlist rendering ────────────────────────────────────────────────────────
function renderPlaylist() {
  playlistEl.innerHTML = '';
  const q   = searchQuery;
  const src = q ? playlist.filter(t =>
    t.title.toLowerCase().includes(q) ||
    t.artist.toLowerCase().includes(q) ||
    t.album.toLowerCase().includes(q)) : playlist;

  src.forEach((track, visIdx) => {
    const realIdx = playlist.indexOf(track);
    const li      = document.createElement('li');
    li.className  = 'playlist-item' + (realIdx === currentIndex ? ' active' : '');
    li.dataset.index = realIdx;
    li.draggable  = true;

    const star  = isStar(track.filePath);
    const color = getLabel(track.filePath);
    const bpm   = getBPM(track.filePath);

    li.innerHTML = `
      <span class="pl-num">${visIdx + 1}</span>
      ${star ? '<span class="pl-star">★</span>' : ''}
      ${color ? `<span class="pl-label" data-color="${escHtml(color)}"></span>` : ''}
      <div class="pl-info">
        <div class="pl-title">${escHtml(track.title)}</div>
        <div class="pl-artist">${escHtml(track.artist)}</div>
      </div>
      ${bpm ? `<span class="pl-duration" style="color:var(--text-dim);font-size:9px">${bpm}</span>` : ''}
      <span class="pl-duration">${fmt(track.duration)}</span>
    `;

    li.addEventListener('click',       () => { loadTrack(realIdx); audio.play(); });
    li.addEventListener('contextmenu', e  => showContextMenu(e, realIdx));
    li.addEventListener('dragstart',   onDragStart);
    li.addEventListener('dragover',    onDragOver);
    li.addEventListener('dragleave',   onDragLeave);
    li.addEventListener('drop',        onDrop);
    li.addEventListener('dragend',     onDragEnd);

    playlistEl.appendChild(li);
  });
}

// ── Drag-to-reorder ───────────────────────────────────────────────────────────
let dragSrcIdx = null;

function onDragStart(e) {
  dragSrcIdx = parseInt(e.currentTarget.dataset.index);
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(e) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}
function onDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function onDrop(e) {
  e.preventDefault();
  const tgt = parseInt(e.currentTarget.dataset.index);
  e.currentTarget.classList.remove('drag-over');
  if (dragSrcIdx === null || dragSrcIdx === tgt) return;
  const moved = playlist.splice(dragSrcIdx, 1)[0];
  playlist.splice(tgt, 0, moved);
  if (currentIndex === dragSrcIdx)                          currentIndex = tgt;
  else if (dragSrcIdx < currentIndex && tgt >= currentIndex) currentIndex--;
  else if (dragSrcIdx > currentIndex && tgt <= currentIndex) currentIndex++;
  rebuildShuffleOrder();
  renderPlaylist();
  persistActivePlaylist();
}
function onDragEnd(e) { e.currentTarget.classList.remove('dragging'); dragSrcIdx = null; }

// ── Queue rendering ───────────────────────────────────────────────────────────
function renderQueue() {
  queueList.innerHTML = '';
  const q = getQueue();
  queueCount.textContent = q.length ? `${q.length} in queue` : 'Queue empty';
  q.forEach((fp, i) => {
    const track = allTracks.find(t => t.filePath === fp) || { title: fp.split(/[\\/]/).pop(), artist: '' };
    const li = document.createElement('li');
    li.className = 'playlist-item';
    li.innerHTML = `
      <span class="pl-num">${i + 1}</span>
      <div class="pl-info">
        <div class="pl-title">${escHtml(track.title)}</div>
        <div class="pl-artist">${escHtml(track.artist)}</div>
      </div>
      <button class="small-btn" data-fp="${escHtml(fp)}" style="flex-shrink:0">✕</button>
    `;
    li.querySelector('button').addEventListener('click', ev => {
      ev.stopPropagation();
      removeFromQueue(fp);
      renderQueue();
    });
    li.addEventListener('click', () => {
      removeFromQueue(fp);
      const idx = playlist.findIndex(t => t.filePath === fp);
      if (idx >= 0) { loadTrack(idx); audio.play(); }
    });
    queueList.appendChild(li);
  });
}

// ── Browse view ───────────────────────────────────────────────────────────────
let browseMode = 'artists'; // 'artists' | 'albums'

function renderBrowse() {
  browseContent.innerHTML = '';
  if (browseMode === 'artists') {
    const map = new Map();
    allTracks.forEach(t => {
      if (!map.has(t.artist)) map.set(t.artist, 0);
      map.set(t.artist, map.get(t.artist) + 1);
    });
    [...map.entries()].sort((a,b) => a[0].localeCompare(b[0])).forEach(([artist, cnt]) => {
      const div = document.createElement('div');
      div.className = 'browse-item';
      div.innerHTML = `<div>${escHtml(artist)}</div><div class="browse-item-sub">${cnt} track${cnt !== 1 ? 's':''}</div>`;
      div.addEventListener('click', () => {
        const tracks = allTracks.filter(t => t.artist === artist);
        loadTrackSet(tracks);
        switchSidebarTab('library');
      });
      browseContent.appendChild(div);
    });
  } else {
    const map = new Map();
    allTracks.forEach(t => {
      const key = t.artist + '\0' + t.album;
      if (!map.has(key)) map.set(key, { artist: t.artist, album: t.album, art: t.albumArt, count: 0 });
      map.get(key).count++;
    });
    [...map.values()].sort((a,b) => a.album.localeCompare(b.album)).forEach(({ artist, album, count }) => {
      const div = document.createElement('div');
      div.className = 'browse-item';
      div.innerHTML = `<div>${escHtml(album)}</div><div class="browse-item-sub">${escHtml(artist)} · ${count} tracks</div>`;
      div.addEventListener('click', () => {
        const tracks = allTracks.filter(t => t.artist === artist && t.album === album);
        loadTrackSet(tracks);
        switchSidebarTab('library');
      });
      browseContent.appendChild(div);
    });
  }
}

document.querySelectorAll('.btab').forEach(btn => {
  btn.addEventListener('click', () => {
    browseMode = btn.dataset.btab;
    document.querySelectorAll('.btab').forEach(b => b.classList.toggle('active', b === btn));
    renderBrowse();
  });
});

// Load a set of tracks into the active playlist and start from the first
function loadTrackSet(tracks) {
  const newTracks = tracks.filter(t => !playlist.some(p => p.filePath === t.filePath));
  playlist = [...playlist, ...newTracks];
  rebuildShuffleOrder();
  renderPlaylist();
  persistActivePlaylist();
}

// ── Named playlists UI ────────────────────────────────────────────────────────
function renderPlaylistsTab() {
  playlistsEl.innerHTML = '';

  // Auto-playlists
  [AUTO.FAVORITES, AUTO.RECENT, AUTO.MOST].forEach(id => {
    const li = document.createElement('li');
    li.className = 'pl-entry auto';
    li.innerHTML = `<span class="pl-entry-name">${AUTO_NAMES[id]}</span>`;
    li.addEventListener('click', () => switchToPlaylist(id));
    playlistsEl.appendChild(li);
  });

  // User playlists
  const pls = getPlaylists();
  Object.entries(pls).forEach(([id, pl]) => {
    const li = document.createElement('li');
    li.className = 'pl-entry' + (id === getActiveId() ? ' active-pl' : '');
    li.innerHTML = `
      <span class="pl-entry-name">${escHtml(pl.name)}</span>
      <span class="pl-entry-count">${pl.tracks.length}</span>
      ${id !== 'default' ? '<button class="pl-entry-del" title="Delete playlist">✕</button>' : ''}
    `;
    li.addEventListener('click', () => switchToPlaylist(id));
    li.querySelector('.pl-entry-del')?.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Delete playlist "${pl.name}"?`)) { deletePlaylist(id); renderPlaylistsTab(); }
    });
    playlistsEl.appendChild(li);
  });
}

async function switchToPlaylist(id) {
  const isAuto = Object.values(AUTO).includes(id);
  setActivePlaylist(isAuto ? getActiveId() : id);

  if (isAuto) {
    playlist = getAutoTracks(id, allTracks);
  } else {
    const pls = getPlaylists();
    const tracks = (pls[id]?.tracks || []);
    // Load metadata for any tracks not yet in allTracks
    const missing = tracks.filter(fp => !allTracks.find(t => t.filePath === fp));
    for (const fp of missing) {
      const meta = await window.api.readMetadata(fp);
      allTracks.push(meta);
    }
    playlist = tracks.map(fp => allTracks.find(t => t.filePath === fp)).filter(Boolean);
  }

  currentIndex = -1;
  audio.pause(); audio.src = '';
  setPlayIcon(false);
  sortPlaylist();
  renderPlaylist();
  renderPlaylistsTab();
  activePlName.textContent = isAuto ? AUTO_NAMES[id] : (getPlaylists()[id]?.name || 'Default');
  switchSidebarTab('library');
}

// ── Sidebar tab switching ─────────────────────────────────────────────────────
function switchSidebarTab(tab) {
  document.querySelectorAll('.stab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`panel-${tab}`)?.classList.remove('hidden');
  if (tab === 'queue')     renderQueue();
  if (tab === 'browse')    renderBrowse();
  if (tab === 'playlists') renderPlaylistsTab();
}

document.querySelectorAll('.stab').forEach(btn => {
  btn.addEventListener('click', () => switchSidebarTab(btn.dataset.tab));
});

// ── Now-playing UI updates ────────────────────────────────────────────────────
function updateNowPlayingUI() {
  const track = playlist[currentIndex];
  if (!track) return;

  trackTitle.textContent  = track.title;
  trackArtist.textContent = track.artist;
  const meta = [];
  if (track.album && track.album !== 'Unknown Album') meta.push(track.album);
  if (track.year)  meta.push(track.year);
  if (track.genre) meta.push(track.genre);
  trackMeta.textContent = meta.join(' · ');

  if (track.albumArt) {
    albumArtEl.src = track.albumArt;
    albumArtEl.classList.add('visible');
    artPlaceholder.style.display = 'none';
  } else {
    albumArtEl.classList.remove('visible');
    artPlaceholder.style.display = 'flex';
  }

  // Star
  const starred = isStar(track.filePath);
  btnStar.textContent = starred ? '★' : '☆';
  btnStar.classList.toggle('starred', starred);

  // Label
  const color = getLabel(track.filePath);
  if (color) { labelDot.dataset.color = color; labelDot.classList.remove('hidden'); }
  else { labelDot.classList.add('hidden'); }

  // BPM
  const cachedBPM = getBPM(track.filePath);
  updateBPMDisplay(cachedBPM);

  // Dynamic background
  applyDynamicBg(track.albumArt);

  // Mini player sync
  if (miniOpen) {
    window.api.syncMiniTrack({ title: track.title, artist: track.artist, albumArt: track.albumArt });
  }

  renderPlaylist();
}

function updateBPMDisplay(bpm) {
  if (bpm) { bpmBadge.textContent = `${bpm} BPM`; bpmBadge.classList.remove('hidden'); }
  else { bpmBadge.classList.add('hidden'); }
}

// ── Load track ────────────────────────────────────────────────────────────────
function loadTrack(index, playCrossfade = false) {
  if (index < 0 || index >= playlist.length) return;
  currentIndex = index;
  const track  = playlist[index];

  if (!playCrossfade) {
    cf.cur.src = 'file:///' + track.filePath.replace(/\\/g, '/');
    cf.cur.load();
  }

  seekBar.value         = 0;
  timeCurrent.textContent = '0:00';
  timeTotal.textContent   = fmt(track.duration);

  updateNowPlayingUI();
  loadLyrics(track.filePath);

  // BPM: use cache or request detection
  const cachedBPM = getBPM(track.filePath);
  if (!cachedBPM) requestBPM(track.filePath);

  cfStarted = false;
}

// ── Lyrics ────────────────────────────────────────────────────────────────────
async function loadLyrics(filePath) {
  currentLyrics = [];
  lastLyricIdx  = -1;
  lyricsInner.innerHTML = '';
  const content = await window.api.readLrc(filePath);
  if (!content) return;
  currentLyrics = parseLRC(content);
  currentLyrics.forEach((line, i) => {
    const div = document.createElement('div');
    div.className = 'lyric-line';
    div.dataset.idx = i;
    div.textContent = line.text;
    lyricsInner.appendChild(div);
  });
}

function updateLyrics() {
  if (!currentLyrics.length || audio.paused) return;
  const idx = getCurrentLyricIdx(currentLyrics, audio.currentTime);
  if (idx === lastLyricIdx) return;
  lastLyricIdx = idx;
  lyricsInner.querySelectorAll('.lyric-line').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
  if (idx >= 0) {
    const activeEl = lyricsInner.querySelector(`[data-idx="${idx}"]`);
    activeEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ── Audio events ──────────────────────────────────────────────────────────────
audio.addEventListener('timeupdate', () => {
  if (isSeeking || !audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 1000;
  seekBar.value = pct;
  timeCurrent.textContent = fmt(audio.currentTime);
  updateSeekGradient();
  updateLyrics();

  // Crossfade trigger: start fading out near track end
  if (crossfadeDur > 0 && !cfStarted && audio.duration - audio.currentTime <= crossfadeDur + 0.3) {
    cfStarted = true;
    triggerCrossfade();
  }
});

audio.addEventListener('play',  () => {
  setPlayIcon(true);
  if (miniOpen) window.api.syncMiniState({ isPlaying: true });
});
audio.addEventListener('pause', () => {
  setPlayIcon(false);
  if (miniOpen) window.api.syncMiniState({ isPlaying: false });
});

audio.addEventListener('ended', () => {
  if (cfStarted) return; // crossfade already handled it
  advanceTrack();
});

audio.addEventListener('loadedmetadata', () => {
  timeTotal.textContent = fmt(audio.duration);
});

// ── Crossfade ─────────────────────────────────────────────────────────────────
function triggerCrossfade() {
  const nextIdx = getNextIndex();
  if (nextIdx === null) return;
  const nextTrack = playlist[nextIdx];
  if (!nextTrack) return;

  cf.next.src = 'file:///' + nextTrack.filePath.replace(/\\/g, '/');
  cf.next.load();
  cf.next.play().catch(() => {});

  const pGain = getPrimaryGain();
  const sGain = getSecondaryGain();

  // Determine which gain belongs to which element
  // cf.cur maps to whichever gain is currently at 1
  // For simplicity, just fade both master gains:
  const [fromGain, toGain] = cf.cur === audio
    ? [pGain, sGain] : [sGain, pGain];

  fadeGain(fromGain, 0, crossfadeDur);
  fadeGain(toGain,   1, crossfadeDur, () => {
    cf.cur.pause();
    cf.cur.src = '';
    fromGain.gain.value = 0;
    [cf.cur, cf.next] = [cf.next, cf.cur];
    currentIndex = nextIdx;
    loadLyrics(nextTrack.filePath);
    if (!getBPM(nextTrack.filePath)) requestBPM(nextTrack.filePath);
    updateNowPlayingUI();
    recordPlay(nextTrack.filePath);
    cfStarted = false;
  });
}

// ── "Next index" logic (respects queue, shuffle, repeat) ─────────────────────
function getNextIndex(wrap = true) {
  // 1. Check play-next queue
  const queuedPath = lib.queue[0];
  if (queuedPath) {
    const qIdx = playlist.findIndex(t => t.filePath === queuedPath);
    return qIdx >= 0 ? qIdx : null;
  }

  if (playlist.length === 0) return null;

  if (shuffleOn) {
    const pos = shuffleOrder.indexOf(currentIndex);
    if (pos < shuffleOrder.length - 1) return shuffleOrder[pos + 1];
    if (repeatMode === 'all') return shuffleOrder[0];
    return null;
  }
  if (currentIndex < playlist.length - 1) return currentIndex + 1;
  if (repeatMode === 'all' && wrap) return 0;
  return null;
}

function getPrevIndex() {
  if (shuffleOn) {
    const pos = shuffleOrder.indexOf(currentIndex);
    return pos > 0 ? shuffleOrder[pos - 1] : (repeatMode === 'all' ? shuffleOrder[shuffleOrder.length - 1] : null);
  }
  if (currentIndex > 0) return currentIndex - 1;
  if (repeatMode === 'all') return playlist.length - 1;
  return null;
}

function advanceTrack() {
  if (repeatMode === 'one') { audio.currentTime = 0; audio.play(); return; }

  // Dequeue if something was in queue
  const queued = lib.queue.length > 0 ? dequeue() : null;
  if (queued) {
    const idx = playlist.findIndex(t => t.filePath === queued);
    if (idx >= 0) { loadTrack(idx); audio.play(); renderQueue(); return; }
  }

  const nxt = getNextIndex(true);
  if (nxt !== null) { loadTrack(nxt); audio.play(); }
  else setPlayIcon(false);
}

// ── Seek ──────────────────────────────────────────────────────────────────────
seekBar.addEventListener('mousedown', () => { isSeeking = true; });
seekBar.addEventListener('input',     () => {
  if (!audio.duration) return;
  timeCurrent.textContent = fmt((seekBar.value / 1000) * audio.duration);
  updateSeekGradient();
});
seekBar.addEventListener('change',    () => {
  if (!audio.duration) return;
  audio.currentTime = (seekBar.value / 1000) * audio.duration;
  isSeeking = false;
});

function updateSeekGradient() {
  const pct = (seekBar.value / 1000) * 100;
  seekBar.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--surface2) ${pct}%)`;
}

// ── Volume ────────────────────────────────────────────────────────────────────
function setVolume(v) {
  audio.volume = v;
  audioB.volume = v;
  const pct = v * 100;
  volumeBar.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--surface2) ${pct}%)`;
}

audio.volume = volumeBar.value / 100;
setVolume(audio.volume);

volumeBar.addEventListener('input', () => setVolume(volumeBar.value / 100));

// ── Speed ─────────────────────────────────────────────────────────────────────
speedBar.addEventListener('input', () => {
  const rate = speedBar.value / 100;
  audio.playbackRate = rate;
  audioB.playbackRate = rate;
  speedLabel.textContent = rate.toFixed(1) + '×';
});

// ── Play / pause (with gain fade) ─────────────────────────────────────────────
btnPlay.addEventListener('click', () => {
  resumeCtx();
  if (playlist.length === 0) return;
  if (currentIndex === -1) { loadTrack(0); audio.play(); return; }
  if (audio.paused) {
    const pGain = getPrimaryGain();
    if (pGain) { pGain.gain.value = 0; fadeGain(pGain, 1, 0.25); }
    audio.play();
  } else {
    const pGain = getPrimaryGain();
    if (pGain) fadeGain(pGain, 0, 0.25, () => audio.pause());
    else audio.pause();
  }
});

document.getElementById('btn-prev').addEventListener('click', () => {
  resumeCtx();
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const prev = getPrevIndex();
  if (prev !== null) { loadTrack(prev); audio.play(); }
});

document.getElementById('btn-next').addEventListener('click', () => {
  resumeCtx();
  advanceTrack();
});

// ── Shuffle ───────────────────────────────────────────────────────────────────
btnShuffle.addEventListener('click', () => {
  shuffleOn = !shuffleOn;
  btnShuffle.dataset.on = String(shuffleOn);
  btnShuffle.title = shuffleOn ? 'Shuffle: On' : 'Shuffle: Off';
  if (shuffleOn) rebuildShuffleOrder();
});

// ── Repeat ────────────────────────────────────────────────────────────────────
btnRepeat.addEventListener('click', () => {
  const modes = ['none','all','one'];
  repeatMode = modes[(modes.indexOf(repeatMode) + 1) % 3];
  btnRepeat.dataset.mode = repeatMode;
  btnRepeat.title = repeatMode === 'none' ? 'Repeat: Off' : repeatMode === 'all' ? 'Repeat: All' : 'Repeat: One';
});


// ── Visualiser toggle ─────────────────────────────────────────────────────────
document.getElementById('btn-viz').addEventListener('click', () => {
  vizEnabled = !vizEnabled;
  vizCanvas.classList.toggle('hidden', !vizEnabled);
  if (vizEnabled) { resizeViz(); drawVisualizer(); }
  else { cancelAnimationFrame(vizRafId); vizCtx.clearRect(0,0,vizCanvas.width,vizCanvas.height); }
});

// ── Lyrics toggle ─────────────────────────────────────────────────────────────
document.getElementById('btn-lyrics').addEventListener('click', () => {
  lyricsPanel.classList.toggle('hidden');
});

// ── Sleep timer ───────────────────────────────────────────────────────────────
document.getElementById('btn-sleep').addEventListener('click', e => {
  e.stopPropagation();
  const rect = e.currentTarget.getBoundingClientRect();
  sleepDropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
  sleepDropdown.style.right  = (window.innerWidth - rect.right) + 'px';
  sleepDropdown.classList.toggle('hidden');
});

sleepDropdown.querySelectorAll('.sleep-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    setSleepTimer(parseInt(btn.dataset.min));
    sleepDropdown.classList.add('hidden');
  });
});

// ── Mini player ───────────────────────────────────────────────────────────────
document.getElementById('btn-mini').addEventListener('click', async () => {
  if (!miniOpen) {
    await window.api.openMiniPlayer();
    miniOpen = true;
    if (currentIndex >= 0) {
      const t = playlist[currentIndex];
      window.api.syncMiniTrack({ title: t.title, artist: t.artist, albumArt: t.albumArt });
      window.api.syncMiniState({ isPlaying: !audio.paused });
    }
  } else {
    window.api.closeMiniPlayer();
    miniOpen = false;
  }
});

window.api.onMiniClosed(() => { miniOpen = false; });

window.api.onMiniControl(action => {
  if (action === 'play-pause') btnPlay.click();
  if (action === 'next')       document.getElementById('btn-next').click();
  if (action === 'prev')       document.getElementById('btn-prev').click();
});

// ── Media keys ────────────────────────────────────────────────────────────────
window.api.onMediaKey(action => {
  if (action === 'play-pause') btnPlay.click();
  if (action === 'next')       document.getElementById('btn-next').click();
  if (action === 'prev')       document.getElementById('btn-prev').click();
});

// ── Context menu ──────────────────────────────────────────────────────────────
let ctxTarget = -1;

function showContextMenu(e, index) {
  e.preventDefault();
  ctxTarget = index;

  // Update star label
  const fp     = playlist[index]?.filePath;
  const starred = fp ? isStar(fp) : false;
  document.getElementById('ctx-star').textContent = starred ? '★ Unfavourite' : '☆ Favourite';

  // Populate "Add to Playlist" submenu
  const sub = document.getElementById('ctx-addpl-sub');
  sub.innerHTML = '';
  Object.entries(getPlaylists()).forEach(([id, pl]) => {
    const d = document.createElement('div');
    d.className = 'ctx-item';
    d.textContent = pl.name;
    d.addEventListener('click', () => {
      if (fp) { addToPlaylist(id, fp); renderPlaylistsTab(); }
      hideCtxMenu();
    });
    sub.appendChild(d);
  });

  // Position
  const x = Math.min(e.clientX, window.innerWidth  - 200);
  const y = Math.min(e.clientY, window.innerHeight - 280);
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top  = y + 'px';
  ctxMenu.classList.remove('hidden');
}

function hideCtxMenu() { ctxMenu.classList.add('hidden'); ctxTarget = -1; }

document.getElementById('ctx-play').addEventListener('click', () => {
  if (ctxTarget >= 0) { loadTrack(ctxTarget); audio.play(); } hideCtxMenu();
});
document.getElementById('ctx-next').addEventListener('click', () => {
  const fp = playlist[ctxTarget]?.filePath;
  if (fp) { enqueueNext(fp); renderQueue(); }
  hideCtxMenu();
});
document.getElementById('ctx-star').addEventListener('click', () => {
  const fp = playlist[ctxTarget]?.filePath;
  if (fp) { toggleStar(fp); updateNowPlayingUI(); renderPlaylist(); }
  hideCtxMenu();
});
document.querySelectorAll('.label-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    const fp = playlist[ctxTarget]?.filePath;
    if (fp) { setLabel(fp, opt.dataset.color); updateNowPlayingUI(); renderPlaylist(); }
    hideCtxMenu();
  });
});
document.getElementById('ctx-edit').addEventListener('click', () => {
  openTagEditor(ctxTarget); hideCtxMenu();
});
document.getElementById('ctx-show').addEventListener('click', () => {
  const fp = playlist[ctxTarget]?.filePath;
  if (fp) window.api.showFile(fp);
  hideCtxMenu();
});
document.getElementById('ctx-remove').addEventListener('click', () => {
  if (ctxTarget >= 0) removeTrackFromActive(ctxTarget);
  hideCtxMenu();
});

document.addEventListener('click',       e => { if (!ctxMenu.contains(e.target)) hideCtxMenu(); });
document.addEventListener('contextmenu', e => { if (!ctxMenu.contains(e.target)) hideCtxMenu(); });

// ── Tag editor ────────────────────────────────────────────────────────────────
let tagEditIndex = -1;

function openTagEditor(index) {
  if (index < 0 || index >= playlist.length) return;
  tagEditIndex = index;
  const t = playlist[index];

  document.getElementById('tag-title').value  = t.title  || '';
  document.getElementById('tag-artist').value = t.artist || '';
  document.getElementById('tag-album').value  = t.album  || '';
  document.getElementById('tag-year').value   = t.year   || '';
  document.getElementById('tag-genre').value  = t.genre  || '';

  const artPrev = document.getElementById('tag-art-preview');
  const artPh   = document.getElementById('tag-art-ph');
  if (t.albumArt) { artPrev.src = t.albumArt; artPrev.classList.add('visible'); artPh.style.display='none'; }
  else { artPrev.classList.remove('visible'); artPh.style.display='flex'; }

  const ext = t.filePath.split('.').pop().toLowerCase();
  document.getElementById('tag-note').textContent =
    ext === 'mp3' ? '' : `Note: tag writing only works for MP3 files (this is .${ext})`;

  tagModal.classList.remove('hidden');
}

document.getElementById('tag-modal-close').addEventListener('click',  () => tagModal.classList.add('hidden'));
document.getElementById('tag-modal-cancel').addEventListener('click', () => tagModal.classList.add('hidden'));

document.getElementById('tag-modal-save').addEventListener('click', async () => {
  if (tagEditIndex < 0) return;
  const t    = playlist[tagEditIndex];
  const tags = {
    title:  document.getElementById('tag-title').value,
    artist: document.getElementById('tag-artist').value,
    album:  document.getElementById('tag-album').value,
    year:   document.getElementById('tag-year').value,
    genre:  document.getElementById('tag-genre').value,
  };

  const res = await window.api.writeTags(t.filePath, tags);
  if (!res.ok) {
    document.getElementById('tag-note').textContent = res.error || 'Save failed.';
    return;
  }

  // Update in-memory metadata
  Object.assign(t, tags);
  if (tagEditIndex === currentIndex) updateNowPlayingUI();
  renderPlaylist();
  tagModal.classList.add('hidden');
  persistActivePlaylist();
});

// Download album art from MusicBrainz
document.getElementById('btn-fetch-art').addEventListener('click', async () => {
  if (tagEditIndex < 0) return;
  const t = playlist[tagEditIndex];
  const note = document.getElementById('tag-note');
  note.textContent = 'Searching MusicBrainz…';
  const dataUrl = await window.api.fetchCoverArt(t.artist, t.album);
  if (dataUrl) {
    t.albumArt = dataUrl;
    const artPrev = document.getElementById('tag-art-preview');
    const artPh   = document.getElementById('tag-art-ph');
    artPrev.src = dataUrl; artPrev.classList.add('visible'); artPh.style.display='none';
    note.textContent = 'Art found! Save to apply.';
    if (tagEditIndex === currentIndex) updateNowPlayingUI();
  } else {
    note.textContent = 'No art found on MusicBrainz.';
  }
});

// ── Star / label buttons in now-playing ───────────────────────────────────────
btnStar.addEventListener('click', () => {
  const fp = playlist[currentIndex]?.filePath;
  if (!fp) return;
  const starred = toggleStar(fp);
  btnStar.textContent = starred ? '★' : '☆';
  btnStar.classList.toggle('starred', starred);
  renderPlaylist();
});

document.getElementById('btn-edit-tags').addEventListener('click', () => openTagEditor(currentIndex));
document.getElementById('btn-show-file').addEventListener('click', () => {
  const fp = playlist[currentIndex]?.filePath;
  if (fp) window.api.showFile(fp);
});
document.getElementById('btn-similar').addEventListener('click', () => {
  if (currentIndex < 0) return;
  const genre = playlist[currentIndex]?.genre;
  if (!genre) { alert('No genre info for this track.'); return; }
  // Highlight similar tracks (same genre) in the playlist
  document.querySelectorAll('.playlist-item').forEach(li => {
    const idx = parseInt(li.dataset.index);
    const t   = playlist[idx];
    li.style.opacity = (!t || t.genre === genre) ? '1' : '0.35';
  });
  setTimeout(() => document.querySelectorAll('.playlist-item').forEach(li => li.style.opacity = ''), 4000);
});

// ── Add files / folder ────────────────────────────────────────────────────────
document.getElementById('btn-add-files').addEventListener('click', async () => {
  const paths = await window.api.openFiles();
  await addFiles(paths);
});
document.getElementById('btn-add-folder').addEventListener('click', async () => {
  const paths = await window.api.openFolder();
  await addFiles(paths);
});
document.getElementById('btn-clear').addEventListener('click', () => {
  audio.pause(); audio.src = '';
  playlist = []; currentIndex = -1;
  renderPlaylist(); persistActivePlaylist();
  trackTitle.textContent = 'No track loaded'; trackArtist.textContent = '—'; trackMeta.textContent = '';
  albumArtEl.classList.remove('visible'); artPlaceholder.style.display = 'flex';
  seekBar.value = 0; timeCurrent.textContent = '0:00'; timeTotal.textContent = '0:00';
  updateSeekGradient(); setPlayIcon(false);
  document.querySelector('.main-panel').style.background = '';
});

document.getElementById('btn-export-m3u').addEventListener('click', () => {
  if (!playlist.length) return;
  window.api.exportM3U(playlist.map(t => ({ filePath: t.filePath, title: t.title, artist: t.artist, duration: t.duration })));
});

// ── New playlist ──────────────────────────────────────────────────────────────
document.getElementById('btn-new-playlist').addEventListener('click', () => {
  const name = prompt('Playlist name:');
  if (!name?.trim()) return;
  const id = createPlaylist(name.trim());
  renderPlaylistsTab();
  switchToPlaylist(id);
});

// ── Find duplicates ───────────────────────────────────────────────────────────
document.getElementById('btn-find-dupes').addEventListener('click', () => {
  const groups = new Map();
  allTracks.forEach(t => {
    const key = t.title.toLowerCase().trim() + '|' + t.artist.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  const dupes = [...groups.values()].filter(g => g.length > 1);
  showDupesModal(dupes);
});

function showDupesModal(groups) {
  const body = document.getElementById('dupes-body');
  body.innerHTML = '';
  if (!groups.length) { body.textContent = 'No duplicate tracks found.'; dupesModal.classList.remove('hidden'); return; }
  groups.forEach(group => {
    const div = document.createElement('div');
    div.className = 'dupe-group';
    div.innerHTML = `<div class="dupe-group-title">${escHtml(group[0].title)} — ${escHtml(group[0].artist)}</div>`;
    group.forEach(t => {
      const row = document.createElement('div');
      row.className = 'dupe-row';
      row.innerHTML = `<span class="dupe-row-path">${escHtml(t.filePath)}</span>
        <button class="dupe-remove" data-fp="${escHtml(t.filePath)}">Remove</button>`;
      row.querySelector('.dupe-remove').addEventListener('click', () => {
        const idx = playlist.findIndex(p => p.filePath === t.filePath);
        if (idx >= 0) removeTrackFromActive(idx);
        allTracks = allTracks.filter(p => p.filePath !== t.filePath);
        row.remove();
      });
      div.appendChild(row);
    });
    body.appendChild(div);
  });
  dupesModal.classList.remove('hidden');
}

[document.getElementById('dupes-modal-close'), document.getElementById('dupes-modal-close2')].forEach(b =>
  b?.addEventListener('click', () => dupesModal.classList.add('hidden')));

// ── Missing metadata detector ─────────────────────────────────────────────────
document.getElementById('btn-missing-meta').addEventListener('click', () => {
  const missing = playlist.filter(t =>
    t.title  === t.filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') ||
    t.artist === 'Unknown Artist' || t.album === 'Unknown Album' || !t.albumArt
  );
  if (!missing.length) { alert('All tracks have complete metadata.'); return; }
  const names = missing.map(t => `• ${t.title} (${t.artist})`).join('\n');
  alert(`${missing.length} tracks with incomplete metadata:\n\n${names}`);
});

// ── Bulk rename ───────────────────────────────────────────────────────────────
// (available via the context menu if needed; here as a standalone)
async function bulkRename() {
  if (!playlist.length) return;
  if (!confirm(`Rename ${playlist.length} files to "Artist - Title.ext"?`)) return;
  for (const t of playlist) {
    const dir  = t.filePath.replace(/[\\/][^\\/]+$/, '');
    const ext  = t.filePath.split('.').pop();
    const safe = `${t.artist} - ${t.title}`.replace(/[\\/:*?"<>|]/g, '_');
    const newPath = dir + '\\' + safe + '.' + ext;
    if (newPath === t.filePath) continue;
    const res = await window.api.renameFile(t.filePath, newPath);
    if (res.ok) t.filePath = res.newPath;
  }
  persistActivePlaylist();
}

// ── Remove track ──────────────────────────────────────────────────────────────
function removeTrackFromActive(index) {
  if (index === currentIndex) { audio.pause(); audio.src = ''; setPlayIcon(false); }
  playlist.splice(index, 1);
  if (index < currentIndex)       currentIndex--;
  else if (index === currentIndex) currentIndex = Math.min(currentIndex, playlist.length - 1);
  rebuildShuffleOrder();
  renderPlaylist();
  persistActivePlaylist();
}

// ── Folder auto-watch ─────────────────────────────────────────────────────────
window.api.onFolderFileAdded(async fp => {
  if (allTracks.some(t => t.filePath === fp)) return;
  const meta = await window.api.readMetadata(fp);
  allTracks.push(meta);
  if (!playlist.some(t => t.filePath === fp)) { playlist.push(meta); }
  sortPlaylist(); renderPlaylist(); persistActivePlaylist();
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  switch (e.key) {
    case ' ':         e.preventDefault(); btnPlay.click(); break;
    case 'ArrowRight': audio.currentTime = Math.min(audio.duration||0, audio.currentTime + 5); break;
    case 'ArrowLeft':  audio.currentTime = Math.max(0, audio.currentTime - 5); break;
    case 'ArrowUp':
      volumeBar.value = Math.min(100, parseInt(volumeBar.value) + 5);
      setVolume(volumeBar.value / 100); break;
    case 'ArrowDown':
      volumeBar.value = Math.max(0, parseInt(volumeBar.value) - 5);
      setVolume(volumeBar.value / 100); break;
    case 'n': case 'N': document.getElementById('btn-next').click(); break;
    case 'p': case 'P': document.getElementById('btn-prev').click(); break;
    case 's': case 'S': btnShuffle.click(); break;
    case 'Escape': hideCtxMenu(); sleepDropdown.classList.add('hidden'); tagModal.classList.add('hidden'); break;
  }
});

// ── Persistence ───────────────────────────────────────────────────────────────
function persistActivePlaylist() {
  const activeId = getActiveId();
  // Update library store with current playlist track order
  const pls = getPlaylists();
  if (pls[activeId]) {
    setPlaylistTracks(activeId, playlist.map(t => t.filePath));
  }
  // Also keep legacy playlist.json updated
  window.api.savePlaylist(playlist.map(t => t.filePath));
}

async function addFiles(filePaths) {
  for (const fp of filePaths) {
    if (allTracks.some(t => t.filePath === fp)) continue;
    const meta = await window.api.readMetadata(fp);
    allTracks.push(meta);
    if (!playlist.some(t => t.filePath === fp)) playlist.push(meta);
  }
  sortPlaylist(); renderPlaylist(); persistActivePlaylist();
  renderBrowse();
}

// ── Session save / restore ────────────────────────────────────────────────────
function saveSession() {
  window.api.saveSession({
    filePath:    playlist[currentIndex]?.filePath || null,
    currentTime: audio.currentTime,
    volume:      audio.volume,
    repeatMode,
    shuffleOn,
    speed:       audio.playbackRate,
  });
}

window.addEventListener('beforeunload', saveSession);

// ── Window controls ───────────────────────────────────────────────────────────
document.getElementById('btn-minimize').addEventListener('click', () => window.api.windowMinimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.api.windowMaximize());
document.getElementById('btn-close').addEventListener('click',    () => { saveSession(); window.api.windowClose(); });

// Dismiss dropdowns on outside click
document.addEventListener('click', e => {
  if (!document.getElementById('btn-sleep').contains(e.target)) sleepDropdown.classList.add('hidden');
});

// ── Startup restore ───────────────────────────────────────────────────────────
(async () => {
  // Init audio engine (lazy on first call)
  // Both elements must exist before init — they're in the HTML
  audio.addEventListener('play', () => { resumeCtx(); }, { once: true });

  // Load library data
  await loadLibrary();

  // Restore saved tracks from library, filtering out deleted files
  const activeId   = getActiveId();
  const pls        = getPlaylists();
  const rawPaths   = pls[activeId]?.tracks || [];

  // Fallback: legacy playlist.json (migrate)
  const sourcePaths = rawPaths.length ? rawPaths : await window.api.loadPlaylist();
  const savedPaths  = sourcePaths.length
    ? await window.api.filterExistingPaths(sourcePaths)
    : [];

  // Also prune all other named playlists of deleted files
  for (const [id, pl] of Object.entries(getPlaylists())) {
    const existing = await window.api.filterExistingPaths(pl.tracks || []);
    if (existing.length !== pl.tracks.length) setPlaylistTracks(id, existing);
  }

  if (savedPaths.length) {
    await addFiles(savedPaths);
    if (rawPaths.length === 0) setPlaylistTracks(activeId, savedPaths);
  }

  // Scan watched folders for new files
  const newFiles = await window.api.scanWatchedFolders(allTracks.map(t => t.filePath));
  if (newFiles.length) await addFiles(newFiles);

  // Restore session (position only, do not auto-play)
  const session = await window.api.loadSession();
  if (session) {
    if (session.speed) { audio.playbackRate = session.speed; speedBar.value = session.speed * 100; speedLabel.textContent = session.speed.toFixed(1) + '×'; }
    if (session.volume !== undefined) { setVolume(session.volume); volumeBar.value = session.volume * 100; }
    if (session.repeatMode) { repeatMode = session.repeatMode; btnRepeat.dataset.mode = repeatMode; }
    if (session.shuffleOn)  { shuffleOn  = true; btnShuffle.dataset.on = 'true'; rebuildShuffleOrder(); }

    if (session.filePath) {
      const idx = playlist.findIndex(t => t.filePath === session.filePath);
      if (idx >= 0) {
        loadTrack(idx); // loads UI without playing
        if (session.currentTime) {
          audio.addEventListener('loadedmetadata', () => {
            audio.currentTime = session.currentTime;
            const pct = (session.currentTime / audio.duration) * 1000;
            seekBar.value = pct;
            updateSeekGradient();
          }, { once: true });
          // Need to load src to get loadedmetadata
          audio.src = 'file:///' + session.filePath.replace(/\\/g, '/');
          audio.load();
        }
      }
    }
  }

  // Init audio engine after DOM is ready
  initAudioEngine(audio, audioB);
  cf.curGain  = getPrimaryGain();
  cf.nextGain = getSecondaryGain();

  // Render playlists tab
  renderPlaylistsTab();
  activePlName.textContent = pls[activeId]?.name || 'Default';
  renderBrowse();
})();
