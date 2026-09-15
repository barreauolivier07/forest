const STORAGE_KEY = "forest.workouts.v1";
const HISTORY_KEY = "forest.history.v1";
const SETTINGS_KEY = "forest.settings.v1";

const DEFAULT_SETTINGS = {
  voiceVolume: 1, // 0..1
  firstName: "Olivier",
  voiceGender: "male", // 'male' | 'female'
  sequenceHelpEnabled: true, // aide visuelle + vocale au focus, dans le formulaire de séquence
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function loadWorkouts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveWorkouts(workouts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workouts));
}

export function newSequence() {
  return {
    id: uid(),
    name: "",
    playStartSound: true,
    metricType: "time", // 'time' | 'distance'
    durationSec: 30,
    distanceM: 200,
    voiceAlertMode: "beforeEnd", // 'none' | 'beforeEnd'
    alertLeadSec: 10,
    alertLeadM: 50,
    speedEnabled: false, // option indépendante du type : maintenir une vitesse cible
    targetSpeedKmh: 10,
    toleranceRatio: 0.05,
    repetitions: 1,
  };
}

export function duplicateSequence(seq) {
  return { ...seq, id: uid() };
}

export function newWorkout() {
  return { id: uid(), name: "", sequences: [] };
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
