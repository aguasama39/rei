// ── State ──────────────────────────────────────────────────────────────────
let playlist = [];       // Array of metadata objects
let currentIndex = -1;
let isSeeking = false;
// repeat: 'none' | 'all' | 'one'
let repeatMode = 'none';

// ── DOM refs ───────────────────────────────────────────────────────────────
const audio         = document.getElementById('audio');
const playlistEl    = document.getElementById('playlist');
const albumArtEl    = document.getElementById('album-art');
const artPlaceholder= document.getElementById('art-placeholder');
const trackTitle    = document.getElementById('track-title');
const trackArtist   = document.getElementById('track-artist');
const trackMeta     = document.getElementById('track-meta');
const seekBar       = document.getElementById('seek-bar');
const timeCurrent   = document.getElementById('time-current');
const timeTotal     = document.getElementById('time-total');
const volumeBar     = document.getElementById('volume-bar');
const btnPlay       = document.getElementById('btn-play');
const iconPlay      = btnPlay.querySelector('.icon-play');
const iconPause     = btnPlay.querySelector('.icon-pause');
const btnRepeat     = document.getElementById('btn-repeat');

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function setPlayIcon(playing) {
  iconPlay.style.display  = playing ? 'none' : 'block';
  iconPause.style.display = playing ? 'block' : 'none';
}

// ── Search ─────────────────────────────────────────────────────────────────
const searchInput = document.getElementById('search-input');
let searchQuery = '';

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.toLowerCase();
  renderPlaylist();
});

// ── Playlist rendering ─────────────────────────────────────────────────────
function renderPlaylist() {
  playlistEl.innerHTML = '';
  const filtered = searchQuery
    ? playlist.filter(t =>
        t.title.toLowerCase().includes(searchQuery) ||
        t.artist.toLowerCase().includes(searchQuery) ||
        t.album.toLowerCase().includes(searchQuery))
    : playlist;

  filtered.forEach((track, i) => {
    const realIndex = playlist.indexOf(track);
    const li = document.createElement('li');
    li.className = 'playlist-item' + (realIndex === currentIndex ? ' active' : '');
    li.dataset.index = realIndex;
    li.draggable = true;

    li.innerHTML = `
      <span class="pl-num">${i + 1}</span>
      <div class="pl-info">
        <div class="pl-title">${escHtml(track.title)}</div>
        <div class="pl-artist">${escHtml(track.artist)}</div>
      </div>
      <span class="pl-duration">${fmt(track.duration)}</span>
    `;

    li.addEventListener('click', () => loadTrack(realIndex));
    li.addEventListener('dblclick', () => { loadTrack(realIndex); audio.play(); });

    // Drag-to-reorder
    li.addEventListener('dragstart', onDragStart);
    li.addEventListener('dragover',  onDragOver);
    li.addEventListener('dragleave', onDragLeave);
    li.addEventListener('drop',      onDrop);
    li.addEventListener('dragend',   onDragEnd);

    playlistEl.appendChild(li);
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Drag-to-reorder ────────────────────────────────────────────────────────
let dragSrcIndex = null;

function onDragStart(e) {
  dragSrcIndex = parseInt(e.currentTarget.dataset.index);
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  const targetIndex = parseInt(e.currentTarget.dataset.index);
  e.currentTarget.classList.remove('drag-over');
  if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

  const moved = playlist.splice(dragSrcIndex, 1)[0];
  playlist.splice(targetIndex, 0, moved);

  // Adjust currentIndex after reorder
  if (currentIndex === dragSrcIndex) {
    currentIndex = targetIndex;
  } else if (dragSrcIndex < currentIndex && targetIndex >= currentIndex) {
    currentIndex--;
  } else if (dragSrcIndex > currentIndex && targetIndex <= currentIndex) {
    currentIndex++;
  }

  renderPlaylist();
  persistPlaylist();
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  dragSrcIndex = null;
}

// ── Load & play ────────────────────────────────────────────────────────────
function loadTrack(index) {
  if (index < 0 || index >= playlist.length) return;
  currentIndex = index;
  const track = playlist[index];

  // Use file:// URI for Electron
  audio.src = 'file://' + track.filePath.replace(/\\/g, '/');
  audio.load();

  // UI update
  trackTitle.textContent  = track.title;
  trackArtist.textContent = track.artist;

  const metaParts = [];
  if (track.album && track.album !== 'Unknown Album') metaParts.push(track.album);
  if (track.year) metaParts.push(track.year);
  if (track.genre) metaParts.push(track.genre);
  trackMeta.textContent = metaParts.join(' · ');

  if (track.albumArt) {
    albumArtEl.src = track.albumArt;
    albumArtEl.classList.add('visible');
    artPlaceholder.style.display = 'none';
  } else {
    albumArtEl.classList.remove('visible');
    artPlaceholder.style.display = 'flex';
  }

  seekBar.value = 0;
  timeCurrent.textContent = '0:00';
  timeTotal.textContent   = fmt(track.duration);

  renderPlaylist();
}

// ── Audio events ───────────────────────────────────────────────────────────
audio.addEventListener('timeupdate', () => {
  if (isSeeking || !audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 1000;
  seekBar.value = pct;
  timeCurrent.textContent = fmt(audio.currentTime);
  updateSeekGradient();
});

audio.addEventListener('play',  () => setPlayIcon(true));
audio.addEventListener('pause', () => setPlayIcon(false));

audio.addEventListener('ended', () => {
  if (repeatMode === 'one') {
    audio.currentTime = 0;
    audio.play();
  } else if (currentIndex < playlist.length - 1) {
    loadTrack(currentIndex + 1);
    audio.play();
  } else if (repeatMode === 'all') {
    loadTrack(0);
    audio.play();
  } else {
    setPlayIcon(false);
  }
});

audio.addEventListener('loadedmetadata', () => {
  timeTotal.textContent = fmt(audio.duration);
});

// ── Seek bar ───────────────────────────────────────────────────────────────
seekBar.addEventListener('mousedown', () => { isSeeking = true; });

seekBar.addEventListener('input', () => {
  if (!audio.duration) return;
  const t = (seekBar.value / 1000) * audio.duration;
  timeCurrent.textContent = fmt(t);
  updateSeekGradient();
});

seekBar.addEventListener('change', () => {
  if (!audio.duration) return;
  audio.currentTime = (seekBar.value / 1000) * audio.duration;
  isSeeking = false;
});

function updateSeekGradient() {
  const pct = (seekBar.value / 1000) * 100;
  seekBar.style.background =
    `linear-gradient(to right, var(--accent) ${pct}%, var(--surface2) ${pct}%)`;
}

// ── Volume ─────────────────────────────────────────────────────────────────
audio.volume = volumeBar.value / 100;

volumeBar.addEventListener('input', () => {
  audio.volume = volumeBar.value / 100;
  const pct = volumeBar.value;
  volumeBar.style.background =
    `linear-gradient(to right, var(--accent) ${pct}%, var(--surface2) ${pct}%)`;
});

// Set initial gradient
volumeBar.style.background =
  `linear-gradient(to right, var(--accent) ${volumeBar.value}%, var(--surface2) ${volumeBar.value}%)`;

// ── Controls ───────────────────────────────────────────────────────────────
btnPlay.addEventListener('click', () => {
  if (playlist.length === 0) return;
  if (currentIndex === -1) { loadTrack(0); audio.play(); return; }
  audio.paused ? audio.play() : audio.pause();
});

document.getElementById('btn-prev').addEventListener('click', () => {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (currentIndex > 0) { loadTrack(currentIndex - 1); audio.play(); }
});

btnRepeat.addEventListener('click', () => {
  const modes = ['none', 'all', 'one'];
  repeatMode = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
  btnRepeat.dataset.mode = repeatMode;
  btnRepeat.title = repeatMode === 'none' ? 'Repeat: Off'
                  : repeatMode === 'all'  ? 'Repeat: All'
                  :                         'Repeat: One';
});

document.getElementById('btn-next').addEventListener('click', () => {
  if (currentIndex < playlist.length - 1) {
    loadTrack(currentIndex + 1);
    audio.play();
  }
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      btnPlay.click();
      break;
    case 'ArrowRight':
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
      break;
    case 'ArrowLeft':
      audio.currentTime = Math.max(0, audio.currentTime - 5);
      break;
    case 'ArrowUp':
      volumeBar.value = Math.min(100, parseInt(volumeBar.value) + 5);
      volumeBar.dispatchEvent(new Event('input'));
      break;
    case 'ArrowDown':
      volumeBar.value = Math.max(0, parseInt(volumeBar.value) - 5);
      volumeBar.dispatchEvent(new Event('input'));
      break;
  }
});

// ── Playlist persistence ───────────────────────────────────────────────────
function persistPlaylist() {
  window.api.savePlaylist(playlist.map(t => t.filePath));
}

// ── Add files / folder ─────────────────────────────────────────────────────
function sortPlaylist() {
  const current = currentIndex >= 0 ? playlist[currentIndex] : null;
  playlist.sort((a, b) =>
    a.artist.localeCompare(b.artist) ||
    a.album.localeCompare(b.album) ||
    (a.track || 0) - (b.track || 0) ||
    a.title.localeCompare(b.title)
  );
  if (current) currentIndex = playlist.indexOf(current);
}

async function addFiles(filePaths) {
  for (const fp of filePaths) {
    if (playlist.some(t => t.filePath === fp)) continue;
    const meta = await window.api.readMetadata(fp);
    playlist.push(meta);
  }
  sortPlaylist();
  renderPlaylist();
  persistPlaylist();
}

document.getElementById('btn-add-files').addEventListener('click', async () => {
  const paths = await window.api.openFiles();
  await addFiles(paths);
});

document.getElementById('btn-add-folder').addEventListener('click', async () => {
  const paths = await window.api.openFolder();
  await addFiles(paths);
});

document.getElementById('btn-clear').addEventListener('click', () => {
  audio.pause();
  audio.src = '';
  playlist = [];
  currentIndex = -1;
  renderPlaylist();
  persistPlaylist();
  trackTitle.textContent  = 'No track loaded';
  trackArtist.textContent = '—';
  trackMeta.textContent   = '';
  albumArtEl.classList.remove('visible');
  artPlaceholder.style.display = 'flex';
  seekBar.value = 0;
  timeCurrent.textContent = '0:00';
  timeTotal.textContent   = '0:00';
  updateSeekGradient();
  setPlayIcon(false);
});

// ── Folder auto-watch ──────────────────────────────────────────────────────
window.api.onFolderFileAdded(async (filePath) => {
  if (playlist.some(t => t.filePath === filePath)) return;
  const meta = await window.api.readMetadata(filePath);
  playlist.push(meta);
  sortPlaylist();
  renderPlaylist();
  persistPlaylist();
});

// ── Restore playlist on startup ────────────────────────────────────────────
(async () => {
  const savedPaths = await window.api.loadPlaylist();
  if (savedPaths.length > 0) await addFiles(savedPaths);
  const newFiles = await window.api.scanWatchedFolders(playlist.map(t => t.filePath));
  if (newFiles.length > 0) await addFiles(newFiles);
})();

// ── Window controls ────────────────────────────────────────────────────────
document.getElementById('btn-minimize').addEventListener('click', () => window.api.windowMinimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.api.windowMaximize());
document.getElementById('btn-close').addEventListener('click',    () => window.api.windowClose());
