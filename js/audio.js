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

// Le Web Speech API n'expose aucune info de genre sur les voix : on approxime via des
// indices dans leur nom (variable selon le téléphone/OS — au pire, les deux choix
// retombent sur la même unique voix française disponible).
const FEMALE_NAME_HINTS = /amélie|amelie|audrey|aurélie|aurelie|céline|celine|chloé|chloe|julie|léa|lea|marie|virginie|hortense|female|femme/i;
const MALE_NAME_HINTS = /thomas|nicolas|daniel|henri|bruno|guillaume|maxime|paul|male|homme/i;

function frenchVoices() {
  if (!("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("fr"));
}

function pickVoiceForGender(gender) {
  const voices = frenchVoices();
  if (voices.length === 0) return null;
  const hints = gender === "female" ? FEMALE_NAME_HINTS : MALE_NAME_HINTS;
  return voices.find((v) => hints.test(v.name)) || voices[0];
}

let currentVolume = 1;
let currentGender = "male";

/** Applique les réglages utilisateur (volume, genre de voix) aux prochaines annonces. */
export function applyAudioSettings(settings) {
  currentVolume = settings.voiceVolume;
  currentGender = settings.voiceGender;
}

export function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "fr-FR";
    const voice = pickVoiceForGender(currentGender);
    if (voice) utter.voice = voice;
    utter.rate = 1;
    utter.volume = currentVolume;
    window.speechSynthesis.speak(utter);
  } catch {
    /* synthèse vocale indisponible, on ignore */
  }
}

/** Aperçu immédiat (réglages de la boîte de dialogue Paramètres, pas encore enregistrés). */
export function previewVoice(text, volume, gender) {
  if (!("speechSynthesis" in window) || !text) return;
  try {
    window.speechSynthesis.cancel(); // évite d'empiler les aperçus pendant qu'on glisse le curseur
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "fr-FR";
    const voice = pickVoiceForGender(gender);
    if (voice) utter.voice = voice;
    utter.volume = volume;
    window.speechSynthesis.speak(utter);
  } catch {
    /* ignore */
  }
}

export function speechSupported() {
  return "speechSynthesis" in window;
}
