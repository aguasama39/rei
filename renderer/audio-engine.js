// audio-engine.js — Web Audio API graph: gain fading, analyser, crossfade support

let _ctx = null;
const _n = {};

/**
 * Build the audio graph. Must be called once; safe to call again (no-op).
 * @param {HTMLAudioElement} primary   — main playback element (#audio)
 * @param {HTMLAudioElement} secondary — crossfade element (#audio-b)
 */
export function initAudioEngine(primary, secondary) {
  if (_ctx) return;
  _ctx = new AudioContext();

  // Per-element gain nodes (crossfade control)
  _n.primaryGain   = _ctx.createGain();
  _n.secondaryGain = _ctx.createGain();
  _n.secondaryGain.gain.value = 0;

  // Analyser (pre-output)
  _n.analyser = _ctx.createAnalyser();
  _n.analyser.fftSize = 2048;
  _n.analyser.smoothingTimeConstant = 0.8;

  // Graph:  primarySrc  → primaryGain  ─┐
  //                                      ├→ analyser → dest
  //         secondarySrc → secondaryGain ┘
  const pSrc = _ctx.createMediaElementSource(primary);
  const sSrc = _ctx.createMediaElementSource(secondary);

  pSrc.connect(_n.primaryGain);
  sSrc.connect(_n.secondaryGain);

  _n.primaryGain.connect(_n.analyser);
  _n.secondaryGain.connect(_n.analyser);

  _n.analyser.connect(_ctx.destination);
}

// ── Accessors ─────────────────────────────────────────────────────────────────
export const getCtx          = () => _ctx;
export const getAnalyser     = () => _n.analyser;
export const getPrimaryGain  = () => _n.primaryGain;
export const getSecondaryGain = () => _n.secondaryGain;

/** Resume context after browser autoplay suspension. Returns a Promise. */
export function resumeCtx() {
  if (_ctx?.state === 'suspended') return _ctx.resume();
  return Promise.resolve();
}

// ── Gain fading ───────────────────────────────────────────────────────────────
/**
 * Smoothly ramp gainNode to targetValue over durationSec.
 * Calls onComplete (if provided) when done.
 */
export function fadeGain(gainNode, targetValue, durationSec, onComplete) {
  if (!_ctx || !gainNode) { onComplete?.(); return; }
  const now = _ctx.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(targetValue, now + durationSec);
  if (onComplete) setTimeout(onComplete, durationSec * 1000 + 80);
}

// ── Analyser data ─────────────────────────────────────────────────────────────
/** Return Uint8Array of frequency-domain data for the visualiser, or null */
export function getFrequencyData() {
  if (!_n.analyser) return null;
  const buf = new Uint8Array(_n.analyser.frequencyBinCount);
  _n.analyser.getByteFrequencyData(buf);
  return buf;
}
