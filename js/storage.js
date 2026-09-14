const STORAGE_KEY = "forest.workouts.v1";

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
