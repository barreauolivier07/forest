// Sons (bips synthétisés, sans fichier audio) + annonces vocales (Web Speech API).
// Fonctionne hors-ligne : ni les bips WebAudio ni la synthèse vocale locale du téléphone
// n'ont besoin d'internet.

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/** À appeler depuis un geste utilisateur (ex: clic "Lancer") pour débloquer l'audio sur iOS. */
export function unlockAudio() {
  try {
    getAudioCtx();
  } catch {
    // WebAudio indisponible : les bips seront simplement ignorés.
  }
  try {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
  } catch {
    /* ignore */
  }
}

function beep(freq, durationMs, type = "sine", volume = 0.25) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);
    osc.start(now);
    osc.stop(now + durationMs / 1000);
  } catch {
    /* WebAudio indisponible, on ignore silencieusement */
  }
}

export function playStartTone() {
  beep(880, 180);
}

export function playStepEndTone() {
  beep(520, 150);
}

export function playWorkoutEndTone() {
  beep(660, 150);
  setTimeout(() => beep(880, 250), 180);
}

export function playAlertTick() {
  beep(1100, 90, "square", 0.15);
}

let frenchVoice = null;
function pickFrenchVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("fr")) ||
    voices[0] ||
    null
  );
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    frenchVoice = pickFrenchVoice();
  };
  frenchVoice = pickFrenchVoice();
}

export function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "fr-FR";
    if (!frenchVoice) frenchVoice = pickFrenchVoice();
    if (frenchVoice) utter.voice = frenchVoice;
    utter.rate = 1;
    window.speechSynthesis.speak(utter);
  } catch {
    /* synthèse vocale indisponible, on ignore */
  }
}

export function speechSupported() {
  return "speechSynthesis" in window;
}
