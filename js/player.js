import { GpsTracker, isGeolocationSupported } from "./gps.js";
import { playStartTone, playStepEndTone, playWorkoutEndTone, playAlertTick, speak } from "./audio.js";

const TICK_MS = 200;
const SPEED_ALERT_COOLDOWN_MS = 8000;

export function formatMmSs(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function speedPhrase(kmh) {
  return `${Math.round(kmh)} kilomètres heure`;
}

/** Déplie les séquences d'un entraînement en une liste plate d'étapes, répétitions incluses. */
function expandSteps(workout) {
  const steps = [];
  for (const seq of workout.sequences) {
    const reps = Math.max(1, seq.repetitions || 1);
    for (let r = 1; r <= reps; r++) {
      steps.push({ sequence: seq, repIndex: r, repTotal: reps });
    }
  }
  return steps;
}

export class WorkoutPlayer {
  /**
   * @param {object} workout
   * @param {{
   *   onStepStart: (step:object, index:number, total:number) => void,
   *   onTick: (info:object) => void,
   *   onGpsStatus: (status:string) => void,
   *   onComplete: () => void,
   * }} callbacks
   */
  constructor(workout, callbacks) {
    this.workout = workout;
    this.callbacks = callbacks;
    this.steps = expandSteps(workout);
    this.stepIdx = -1;
    this.paused = false;
    this.timer = null;
    this.wakeLock = null;
    this.lastProgress = 0;
    this.totalPausedMs = 0;

    const needsGps = this.steps.some((s) => s.sequence.metricType === "distance" || s.sequence.speedEnabled);
    this.gps = needsGps && isGeolocationSupported() ? new GpsTracker((state) => this._onGpsUpdate(state)) : null;
  }

  start() {
    this.startedAtDate = Date.now(); // horodatage affiché dans l'historique
    this.startedAtPerf = performance.now(); // horloge monotone pour calculer la durée réelle
    if (this.gps) this.gps.start();
    this._requestWakeLock();
    this._goToStep(0);
    this.timer = setInterval(() => this._tick(), TICK_MS);
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.pausedAt = performance.now();
    if (this.gps) this.gps.setPaused(true);
  }

  resume() {
    if (!this.paused) return;
    const pausedDuration = performance.now() - this.pausedAt;
    this.stepDeadline += pausedDuration;
    this.totalPausedMs += pausedDuration;
    this.paused = false;
    if (this.gps) this.gps.setPaused(false);
  }

  /** Résumé de la séance (à appeler avant ou juste après stop()) pour l'historique. */
  getSummary() {
    const totalSteps = this.steps.length;
    const stepsCompleted = Math.min(this.stepIdx, totalSteps);
    const completed = this.stepIdx >= totalSteps;
    const currentProgress = completed ? 0 : Math.max(0, Math.min(1, this.lastProgress || 0));
    const achievementRatio = totalSteps > 0 ? Math.min(1, (stepsCompleted + currentProgress) / totalSteps) : 0;

    let activeMs = performance.now() - this.startedAtPerf - this.totalPausedMs;
    if (this.paused) activeMs -= performance.now() - this.pausedAt;

    return {
      workoutId: this.workout.id,
      workoutName: this.workout.name,
      startedAt: this.startedAtDate,
      durationSec: Math.max(0, Math.round(activeMs / 1000)),
      achievementRatio,
      completed,
    };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.gps) this.gps.stop();
    this._releaseWakeLock();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  async _requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        this.wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch {
      this.wakeLock = null;
    }
  }

  _releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  _goToStep(idx) {
    this.stepIdx = idx;
    if (idx >= this.steps.length) {
      this.stop();
      playWorkoutEndTone();
      speak("Entraînement terminé, bravo !");
      this.callbacks.onComplete();
      return;
    }

    const step = this.steps[idx];
    const seq = step.sequence;
    this.alerted10s = false;
    this.alertedDistanceLead = false;
    this.lastSpeedAlertAt = 0;
    this.speedZone = null; // 'below' | 'onTarget' | 'above'

    if (this.gps) this.gps.reset();

    this.stepDurationMs = seq.metricType === "time" ? seq.durationSec * 1000 : null;
    this.stepDeadline = performance.now() + (this.stepDurationMs || 0);

    if (seq.playStartSound) playStartTone();
    if (seq.name) speak(seq.name);
    if (seq.speedEnabled) speak(`Vitesse cible : ${speedPhrase(seq.targetSpeedKmh)}`);

    this.callbacks.onStepStart(step, idx, this.steps.length);
    this._emitTick();
  }

  _tick() {
    if (this.paused || this.stepIdx < 0 || this.stepIdx >= this.steps.length) return;
    const step = this.steps[this.stepIdx];
    const seq = step.sequence;

    if (seq.speedEnabled) this._checkSpeedTolerance(seq);

    if (seq.metricType === "time") {
      const remainingMs = this.stepDeadline - performance.now();
      if (
        seq.voiceAlertMode === "beforeEnd" &&
        !this.alerted10s &&
        remainingMs <= (seq.alertLeadSec || 10) * 1000
      ) {
        this.alerted10s = true;
        speak(`${seq.alertLeadSec || 10} secondes`);
      }
      if (remainingMs <= 0) {
        this._finishStep();
        return;
      }
    } else if (seq.metricType === "distance") {
      const dist = this.gps ? this.gps.distanceM : 0;
      const remaining = seq.distanceM - dist;
      if (
        seq.voiceAlertMode === "beforeEnd" &&
        !this.alertedDistanceLead &&
        remaining <= (seq.alertLeadM || 50)
      ) {
        this.alertedDistanceLead = true;
        speak(`${seq.alertLeadM || 50} mètres`);
      }
      if (dist >= seq.distanceM) {
        this._finishStep();
        return;
      }
    }

    this._emitTick();
  }

  _checkSpeedTolerance(seq) {
    if (!this.gps) return;
    const current = this.gps.speedKmh;
    const target = seq.targetSpeedKmh;
    const tol = target * seq.toleranceRatio;

    let zone;
    if (current < target - tol) zone = "below";
    else if (current > target + tol) zone = "above";
    else zone = "onTarget";

    if (zone === this.speedZone) return;
    const now = performance.now();
    if (now - this.lastSpeedAlertAt < SPEED_ALERT_COOLDOWN_MS) return;

    this.speedZone = zone;
    this.lastSpeedAlertAt = now;

    if (zone === "onTarget") {
      speak(`Bien, ${speedPhrase(current)}, vitesse cible atteinte`);
    } else {
      playAlertTick();
      speak(zone === "below" ? `Accélère, ${speedPhrase(current)}` : `Ralentis, ${speedPhrase(current)}`);
    }
  }

  _finishStep() {
    playStepEndTone();
    this._goToStep(this.stepIdx + 1);
  }

  _emitTick() {
    const step = this.steps[this.stepIdx];
    const seq = step.sequence;
    const info = { step, index: this.stepIdx, total: this.steps.length, metricType: seq.metricType };

    if (seq.metricType === "time") {
      info.remainingSec = Math.max(0, (this.stepDeadline - performance.now()) / 1000);
      info.progress = 1 - info.remainingSec / seq.durationSec;
    } else if (seq.metricType === "distance") {
      info.distanceM = this.gps ? this.gps.distanceM : 0;
      info.targetDistanceM = seq.distanceM;
      info.progress = info.distanceM / seq.distanceM;
    }

    if (seq.speedEnabled) {
      info.speedEnabled = true;
      info.currentSpeedKmh = this.gps ? this.gps.speedKmh : 0;
      info.targetSpeedKmh = seq.targetSpeedKmh;
    }

    this.lastProgress = info.progress;

    const next = this.steps[this.stepIdx + 1];
    info.nextStepLabel = next ? describeStep(next) : null;

    this.callbacks.onTick(info);
  }

  _onGpsUpdate(state) {
    this.callbacks.onGpsStatus(state.status);
  }
}

export function describeStep(step) {
  const seq = step.sequence;
  const base = seq.name || defaultNameForType(seq.metricType);
  const repSuffix = step.repTotal > 1 ? ` (${step.repIndex}/${step.repTotal})` : "";
  return base + repSuffix;
}

function defaultNameForType(type) {
  if (type === "distance") return "Séquence distance";
  return "Séquence";
}

export function summarizeSequence(seq) {
  let core = seq.metricType === "time" ? formatMmSs(seq.durationSec) : formatDistance(seq.distanceM);
  if (seq.speedEnabled) {
    core += ` · ${seq.targetSpeedKmh} km/h (±${seq.toleranceRatio * 100}%)`;
  }
  const reps = seq.repetitions > 1 ? ` × ${seq.repetitions}` : "";
  return core + reps;
}
