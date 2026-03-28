// lyrics.js — .lrc file parser and sync helpers

/**
 * Parse LRC text into an array of { time: number, text: string } sorted by time.
 * Handles multiple timestamps per line and skips metadata-only lines.
 */
export function parseLRC(content) {
  const entries = [];
  const timeRe  = /\[(\d{1,2}):(\d{2})\.(\d{2,3})\]/g;

  for (const line of content.replace(/\r/g, '').split('\n')) {
    const text = line.replace(/\[\d{1,2}:\d{2}\.\d{2,3}\]/g, '').trim();
    if (!text) continue;

    for (const m of line.matchAll(timeRe)) {
      const dec = m[3].length === 2 ? 100 : 1000;
      const t   = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / dec;
      entries.push({ time: t, text });
    }
  }

  return entries.sort((a, b) => a.time - b.time);
}

/**
 * Binary-search for the index of the lyric line currently active at currentTime.
 * Returns -1 if before the first line.
 */
export function getCurrentLyricIdx(lyrics, currentTime) {
  let lo = 0, hi = lyrics.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lyrics[mid].time <= currentTime) { idx = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return idx;
}
