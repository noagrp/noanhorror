const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const VOICE_ALIAS = 'am_fenrir';
const LOCAL_VOICE = new URL('./voice/am_granite.bin', self.location.href).href;
const originalFetch = self.fetch.bind(self);
let ttsPromise = null;

self.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : input?.url;
  if (url && /\/voices\/am_fenrir\.bin(?:\?|$)/.test(url)) {
    return originalFetch(LOCAL_VOICE, init);
  }
  return originalFetch(input, init);
};

async function getTTS() {
  if (ttsPromise) return ttsPromise;
  ttsPromise = (async () => {
    const mod = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm');
    const device = self.navigator?.gpu ? 'webgpu' : 'wasm';
    const dtype = self.navigator?.gpu ? 'q8' : 'q4';
    return mod.KokoroTTS.from_pretrained(MODEL_ID, { device, dtype });
  })();
  return ttsPromise;
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === 'preload') {
      await getTTS();
      self.postMessage({ type: 'ready' });
      return;
    }

    if (msg.type === 'synth') {
      const tts = await getTTS();
      const raw = await tts.generate(msg.text, { voice: VOICE_ALIAS, speed: msg.speed });
      const blob = raw.toBlob();
      const buffer = await blob.arrayBuffer();
      self.postMessage({ type: 'audio', id: msg.id, buffer }, [buffer]);
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: msg.id ?? null, message: error?.message || String(error) });
  }
};
