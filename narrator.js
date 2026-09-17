// Fixed Noan narrator powered by Kokoro in a Web Worker so UI stays responsive.
(() => {
  if (!('speechSynthesis' in window)) return;

  const nativeSynth = window.speechSynthesis;
  const nativeSpeak = nativeSynth.speak.bind(nativeSynth);
  const nativeCancel = nativeSynth.cancel.bind(nativeSynth);
  const NativeUtterance = window.SpeechSynthesisUtterance;

  let worker = null;
  let workerFailed = false;
  let currentAudio = null;
  let currentUrl = null;
  let generation = 0;
  let requestId = 0;
  const pending = new Map();

  class NoanUtterance {
    constructor(text = '') {
      this.text = String(text);
      this.pitch = 1;
      this.rate = 1;
      this.volume = 1;
      this.lang = 'en-US';
      this.voice = null;
      this.onend = null;
      this.onerror = null;
    }
  }

  function setVoiceStatus(text) {
    const btn = document.getElementById('voice-btn');
    if (btn && !btn.classList.contains('muted')) btn.innerText = text;
  }

  function stopCurrent() {
    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      currentAudio.src = '';
      currentAudio = null;
    }
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
  }

  function fallbackSpeak(utterance) {
    const native = new NativeUtterance(utterance.text);
    native.pitch = utterance.pitch;
    native.rate = utterance.rate;
    native.volume = utterance.volume;
    native.lang = utterance.lang || 'en-US';
    native.onend = utterance.onend;
    native.onerror = utterance.onerror;
    nativeSpeak(native);
  }

  function legacyTempo(rate) {
    if (rate >= 1.15) return 1.15;
    if (rate >= 0.9) return 1.05;
    if (rate <= 0.72) return 0.88;
    return 0.95;
  }

  function resetWorker() {
    if (worker) {
      try { worker.terminate(); } catch {}
      worker = null;
    }
    pending.clear();
  }

  function ensureWorker() {
    if (worker || workerFailed) return worker;
    try {
      worker = new Worker('./narrator-worker.js?v=2', { type: 'module' });
      worker.onmessage = handleWorkerMessage;
      worker.onerror = (error) => {
        console.warn('Noan narrator worker unavailable; using device voice.', error);
        workerFailed = true;
        setVoiceStatus('VOICE: ON');
        const waiting = [...pending.values()];
        pending.clear();
        resetWorker();
        waiting.forEach(item => {
          if (item.runId === generation) fallbackSpeak(item.utterance);
        });
      };
      return worker;
    } catch (error) {
      console.warn('Noan narrator worker unavailable; using device voice.', error);
      workerFailed = true;
      return null;
    }
  }

  async function playWorkerAudio(item, buffer) {
    if (item.runId !== generation) return;
    const blob = new Blob([buffer], { type: 'audio/wav' });
    currentUrl = URL.createObjectURL(blob);
    const audio = new Audio(currentUrl);
    currentAudio = audio;
    audio.volume = Math.max(0, Math.min(1, Number(item.utterance.volume) || 1));
    audio.playbackRate = item.pitchFactor;
    audio.preservesPitch = false;
    audio.mozPreservesPitch = false;
    audio.webkitPreservesPitch = false;

    try {
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = reject;
        audio.play().catch(reject);
      });
      if (currentAudio === audio) stopCurrent();
      if (item.runId === generation && typeof item.utterance.onend === 'function') {
        item.utterance.onend({ utterance: item.utterance });
      }
    } catch (error) {
      if (currentAudio === audio) stopCurrent();
      if (item.runId === generation && typeof item.utterance.onerror === 'function') {
        item.utterance.onerror(error);
      }
    }
  }

  function handleWorkerMessage(event) {
    const msg = event.data || {};
    if (msg.type === 'ready') {
      setVoiceStatus('VOICE: ON');
      return;
    }

    if (msg.type === 'audio') {
      const item = pending.get(msg.id);
      pending.delete(msg.id);
      if (item) playWorkerAudio(item, msg.buffer);
      return;
    }

    if (msg.type === 'error') {
      const item = pending.get(msg.id);
      if (msg.id != null) pending.delete(msg.id);
      console.warn('Noan narrator worker line failed; using device voice.', msg.message);
      if (item && item.runId === generation) fallbackSpeak(item.utterance);
    }
  }

  function speak(utterance) {
    if (!(utterance instanceof NoanUtterance)) {
      nativeSpeak(utterance);
      return;
    }

    const runId = generation;
    if (workerFailed) {
      fallbackSpeak(utterance);
      return;
    }

    const activeWorker = ensureWorker();
    if (!activeWorker) {
      fallbackSpeak(utterance);
      return;
    }

    setVoiceStatus('VOICE: LOAD');
    const pitchFactor = Math.max(0.82, Math.min(1.18, Number(utterance.pitch) || 1));
    const targetTempo = legacyTempo(Number(utterance.rate) || 1);
    const speed = Math.max(0.7, Math.min(1.3, targetTempo / pitchFactor));
    const id = ++requestId;
    pending.set(id, { utterance, runId, pitchFactor });
    activeWorker.postMessage({ type: 'synth', id, text: utterance.text, speed });
  }

  function cancel() {
    generation++;
    stopCurrent();
    nativeCancel();

    if (pending.size > 0) {
      resetWorker();
    }
  }

  window.SpeechSynthesisUtterance = NoanUtterance;
  try { nativeSynth.speak = speak; } catch {}
  try { nativeSynth.cancel = cancel; } catch {}

  window.NoanNarrator = {
    preload: () => {
      const activeWorker = ensureWorker();
      if (!activeWorker) return;
      setVoiceStatus('VOICE: LOAD');
      activeWorker.postMessage({ type: 'preload' });
    },
    cancel,
    get ready() { return !!worker && !workerFailed; }
  };
})();
