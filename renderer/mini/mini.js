const artEl    = document.getElementById('art');
const artPh    = document.getElementById('art-ph');
const titleEl  = document.getElementById('title');
const artistEl = document.getElementById('artist');
const btnPlay  = document.getElementById('btn-play');
const btnPrev  = document.getElementById('btn-prev');
const btnNext  = document.getElementById('btn-next');
const btnClose = document.getElementById('btn-close');

let playing = false;

window.miniApi.onTrack(({ title, artist, albumArt }) => {
  titleEl.textContent  = title  || 'No track';
  artistEl.textContent = artist || '—';
  if (albumArt) {
    artEl.src = albumArt;
    artEl.classList.add('visible');
    artPh.style.display = 'none';
  } else {
    artEl.classList.remove('visible');
    artPh.style.display = 'flex';
  }
});

window.miniApi.onState(({ isPlaying }) => {
  playing = isPlaying;
  btnPlay.innerHTML = isPlaying ? '&#9646;&#9646;' : '&#9654;';
  btnPlay.title = isPlaying ? 'Pause' : 'Play';
});

btnPlay.addEventListener('click',  () => window.miniApi.send('play-pause'));
btnPrev.addEventListener('click',  () => window.miniApi.send('prev'));
btnNext.addEventListener('click',  () => window.miniApi.send('next'));
btnClose.addEventListener('click', () => window.miniApi.close());
