// Microphone capture and PCM playback for the cascade pipeline (ttsVoice.js).
//
// geminiLive.js contains equivalent code for the live pipeline. The two are kept separate so each
// pipeline can be changed or removed without touching the other.

const IN_RATE = 16000; // Gemini Live input
const OUT_RATE = 24000; // Gemini TTS output

const WORKLET = `
class PcmDown extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / ${IN_RATE}; this.pos = 0; this.out = new Int16Array(800); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const s = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.out.length) { this.port.postMessage(this.out.buffer, [this.out.buffer]); this.out = new Int16Array(800); this.n = 0; }
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor('pcm-down', PcmDown);
`;

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function int16ToFloat(bytes) {
  const n = bytes.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    out[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
  }
  return out;
}

/** Microphone to 16 kHz 16-bit PCM chunks of about 50 ms. */
export async function startMic(onChunk) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const node = new AudioWorkletNode(ctx, 'pcm-down');
  node.port.onmessage = (e) => onChunk(e.data);
  ctx.createMediaStreamSource(stream).connect(node);
  await ctx.resume();
  return {
    stream,
    stop() {
      try {
        node.disconnect();
      } catch {}
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}

/**
 * Plays 24 kHz PCM chunks back to back. clear() empties the queue when the visitor starts talking.
 * The output node is also connected to a MediaStreamDestination and exposed as `stream`.
 */
export function createPlayer(onPlaying = () => {}) {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const dest = ctx.createMediaStreamDestination();
  gain.connect(dest);
  const sources = new Set();
  let nextTime = 0;
  let leftover = new Uint8Array(0); // carries an odd trailing byte to the next chunk

  return {
    stream: dest.stream,
    get playing() {
      return sources.size > 0;
    },
    push(bytes) {
      const buf = new Uint8Array(leftover.length + bytes.length);
      buf.set(leftover);
      buf.set(bytes, leftover.length);
      const usable = buf.length - (buf.length % 2);
      leftover = buf.subarray(usable);
      if (!usable) return;
      const pcm = int16ToFloat(buf.subarray(0, usable));
      const ab = ctx.createBuffer(1, pcm.length, OUT_RATE);
      ab.copyToChannel(pcm, 0);
      const src = ctx.createBufferSource();
      src.buffer = ab;
      src.connect(gain);
      const at = Math.max(ctx.currentTime + 0.05, nextTime);
      src.start(at);
      nextTime = at + ab.duration;
      if (!sources.size) onPlaying(true);
      sources.add(src);
      src.onended = () => {
        sources.delete(src);
        if (!sources.size) onPlaying(false);
      };
    },
    clear() {
      for (const s of sources) {
        s.onended = null;
        try {
          s.stop();
        } catch {}
      }
      const was = sources.size;
      sources.clear();
      nextTime = 0;
      leftover = new Uint8Array(0);
      if (was) onPlaying(false);
    },
    async resume() {
      await ctx.resume().catch(() => {});
    },
    close() {
      this.clear();
      ctx.close().catch(() => {});
    },
  };
}
