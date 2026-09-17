// Fixed Noan narrator powered by Kokoro in the browser.
(() => {
  if (!('speechSynthesis' in window)) return;
  const nativeSynth = window.speechSynthesis;
  const nativeSpeak = nativeSynth.speak.bind(nativeSynth);
  const nativeCancel = nativeSynth.cancel.bind(nativeSynth);
  const NativeUtterance = window.SpeechSynthesisUtterance;
  const originalFetch = window.fetch.bind(window);
  let ttsPromise = null, currentAudio = null, currentUrl = null, generation = 0, kokoroFailed = false;
  const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
  const VOICE_ALIAS = 'am_fenrir';
  const LOCAL_VOICE = new URL('./voice/am_granite.bin', location.href).href;
  class NoanUtterance {
    constructor(text = '') { this.text=String(text); this.pitch=1; this.rate=1; this.volume=1; this.lang='en-US'; this.voice=null; this.onend=null; this.onerror=null; }
  }
  function setVoiceStatus(text){ const btn=document.getElementById('voice-btn'); if(btn&&!btn.classList.contains('muted')) btn.innerText=text; }
  async function getTTS(){
    if(ttsPromise) return ttsPromise;
    setVoiceStatus('VOICE: LOAD');
    ttsPromise=(async()=>{
      const mod=await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm');
      const device=navigator.gpu?'webgpu':'wasm';
      const dtype=navigator.gpu?'q8':'q4';
      const tts=await mod.KokoroTTS.from_pretrained(MODEL_ID,{device,dtype});
      setVoiceStatus('VOICE: ON');
      return tts;
    })().catch(err=>{ kokoroFailed=true; ttsPromise=null; setVoiceStatus('VOICE: ON'); console.warn('Kokoro unavailable; using device voice.',err); throw err; });
    return ttsPromise;
  }
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:input?.url;
    if(url&&/\/voices\/am_fenrir\.bin(?:\?|$)/.test(url)) return originalFetch(LOCAL_VOICE,init);
    return originalFetch(input,init);
  };
  function stopCurrent(){
    if(currentAudio){ try{currentAudio.pause();}catch{} currentAudio.src=''; currentAudio=null; }
    if(currentUrl){ URL.revokeObjectURL(currentUrl); currentUrl=null; }
  }
  function legacyTempo(rate){ if(rate>=1.15)return 1.15; if(rate>=0.9)return 1.05; if(rate<=0.72)return 0.88; return 0.95; }
  async function kokoroSpeak(utterance,runId){
    const tts=await getTTS(); if(runId!==generation)return;
    const pitchFactor=Math.max(0.82,Math.min(1.18,Number(utterance.pitch)||1));
    const targetTempo=legacyTempo(Number(utterance.rate)||1);
    const generationSpeed=Math.max(0.7,Math.min(1.3,targetTempo/pitchFactor));
    const raw=await tts.generate(utterance.text,{voice:VOICE_ALIAS,speed:generationSpeed}); if(runId!==generation)return;
    const blob=raw.toBlob(); currentUrl=URL.createObjectURL(blob);
    const audio=new Audio(currentUrl); currentAudio=audio; audio.volume=Math.max(0,Math.min(1,Number(utterance.volume)||1)); audio.playbackRate=pitchFactor;
    audio.preservesPitch=false; audio.mozPreservesPitch=false; audio.webkitPreservesPitch=false;
    await new Promise((resolve,reject)=>{ audio.onended=resolve; audio.onerror=reject; audio.play().catch(reject); });
    if(currentAudio===audio) stopCurrent();
    if(runId===generation&&typeof utterance.onend==='function') utterance.onend({utterance});
  }
  function fallbackSpeak(utterance){
    const native=new NativeUtterance(utterance.text); native.pitch=utterance.pitch; native.rate=utterance.rate; native.volume=utterance.volume; native.lang=utterance.lang||'en-US'; native.onend=utterance.onend; native.onerror=utterance.onerror; nativeSpeak(native);
  }
  function speak(utterance){
    if(!(utterance instanceof NoanUtterance)){ nativeSpeak(utterance); return; }
    const runId=generation;
    if(kokoroFailed){ fallbackSpeak(utterance); return; }
    kokoroSpeak(utterance,runId).catch(err=>{ console.warn('Noan narrator line failed; falling back.',err); if(runId===generation) fallbackSpeak(utterance); });
  }
  function cancel(){ generation++; stopCurrent(); nativeCancel(); }
  window.SpeechSynthesisUtterance=NoanUtterance;
  try{nativeSynth.speak=speak;}catch{}
  try{nativeSynth.cancel=cancel;}catch{}
  window.NoanNarrator={preload:()=>getTTS().catch(()=>null),cancel,get ready(){return !!ttsPromise&&!kokoroFailed;}};
})();
