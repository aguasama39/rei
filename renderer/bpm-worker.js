// bpm-worker.js — BPM detection in a dedicated Web Worker
// Receives: { id, filePath }
// Posts back: { id, bpm }  (bpm = null if detection failed)

self.onmessage = async ({ data: { id, filePath } }) => {
  try {
    const url = 'file:///' + filePath.replace(/\\/g, '/');
    const res  = await fetch(url);
    if (!res.ok) { self.postMessage({ id, bpm: null }); return; }

    const buf = await res.arrayBuffer();

    // Decode at reduced sample rate to keep memory low
    const SR  = 22050;
    const DUR = 30; // analyse first 30 seconds

    let decoded;
    try {
      const tmpCtx = new OfflineAudioContext(1, SR * DUR, SR);
      decoded = await tmpCtx.decodeAudioData(buf.slice(0));
    } catch {
      self.postMessage({ id, bpm: null }); return;
    }

    // Low-pass filter the signal to isolate kick / bass transients
    const offCtx = new OfflineAudioContext(1, decoded.length, SR);
    const src    = offCtx.createBufferSource();
    const flt    = offCtx.createBiquadFilter();
    flt.type     = 'lowpass';
    flt.frequency.value = 150;
    src.buffer   = decoded;
    src.connect(flt);
    flt.connect(offCtx.destination);
    src.start(0);

    const rendered = await offCtx.startRendering();
    const pcm      = rendered.getChannelData(0);

    // Adaptive threshold based on RMS of the filtered signal
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) sumSq += pcm[i] * pcm[i];
    const rms = Math.sqrt(sumSq / pcm.length);
    const thr = Math.max(0.03, rms * 2.8);

    // Peak picking (local max above threshold, min gap ~250 BPM)
    const minGap = Math.round(SR * 0.24);
    const peaks  = [];
    let last     = -minGap;

    for (let i = 1; i < pcm.length - 1; i++) {
      const v = Math.abs(pcm[i]);
      if (v >= thr && v > Math.abs(pcm[i - 1]) && v > Math.abs(pcm[i + 1]) && i - last >= minGap) {
        peaks.push(i);
        last = i;
      }
    }

    if (peaks.length < 4) { self.postMessage({ id, bpm: null }); return; }

    // Median inter-peak interval → BPM
    const ivs = [];
    for (let i = 1; i < peaks.length; i++) ivs.push(peaks[i] - peaks[i - 1]);
    ivs.sort((a, b) => a - b);
    const med = ivs[Math.floor(ivs.length / 2)];

    let bpm = Math.round(60 * SR / med);

    // Normalise to 60–180 BPM range
    while (bpm > 180) bpm = Math.round(bpm / 2);
    while (bpm < 60)  bpm = Math.round(bpm * 2);

    self.postMessage({ id, bpm: bpm >= 40 && bpm <= 220 ? bpm : null });
  } catch {
    self.postMessage({ id, bpm: null });
  }
};
