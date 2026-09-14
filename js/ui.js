import {
  loadWorkouts,
  saveWorkouts,
  newSequence,
  newWorkout,
  duplicateSequence,
  loadHistory,
  saveHistory,
  uid,
} from "./storage.js";
import { unlockAudio } from "./audio.js";
import {
  WorkoutPlayer,
  formatMmSs,
  formatDistance,
  describeStep,
  summarizeSequence,
} from "./player.js";

let workouts = loadWorkouts();
let currentWorkout = null; // entraînement en cours d'édition
let editingSequenceId = null; // null => nouvelle séquence
let player = null;

const el = {};
const ids = [
  "header-title", "btn-back",
  "view-list", "btn-new-workout", "workout-list", "empty-state",
  "btn-install-app", "ios-install-hint",
  "btn-view-history", "view-history", "history-list", "history-empty-state",
  "view-editor", "workout-name", "sequence-list", "sequence-empty-state",
  "btn-add-sequence", "btn-start-workout", "btn-delete-workout",
  "view-player", "player-step-index", "player-progress-fill", "player-step-name",
  "player-big-readout", "player-sub-readout", "player-gps-status", "player-next-step",
  "btn-player-pause", "btn-player-stop",
  "sequence-dialog", "sequence-form", "seq-name", "seq-start-sound",
  "fields-time", "fields-distance",
  "seq-time-duration", "seq-time-voice-mode",
  "seq-distance-value", "seq-distance-voice-mode",
  "seq-speed-enabled", "fields-speed-option", "seq-speed-target", "seq-speed-tolerance",
  "seq-repetitions",
];

function parseMmSs(str) {
  if (!str) return 0;
  const parts = String(str).trim().split(":");
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const s = parseInt(parts[1], 10) || 0;
    return m * 60 + s;
  }
  return parseInt(str, 10) || 0;
}

function persist() {
  saveWorkouts(workouts);
}

const VIEW_TITLES = {
  "view-list": "Forest",
  "view-editor": "Entraînement",
  "view-player": "En cours…",
  "view-history": "Historique",
};

function showView(name) {
  Object.keys(VIEW_TITLES).forEach((id) => {
    el[id].hidden = id !== name;
  });
  el["btn-back"].hidden = name === "view-list";
  el["header-title"].textContent = VIEW_TITLES[name] || "Forest";
}

function formatDateTime(timestamp) {
  const d = new Date(timestamp);
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

function renderWorkoutList() {
  const list = el["workout-list"];
  list.innerHTML = "";
  el["empty-state"].hidden = workouts.length > 0;

  for (const w of workouts) {
    const li = document.createElement("li");
    li.className = "card";
    const totalSeq = w.sequences.reduce((n, s) => n + (s.repetitions || 1), 0);
    li.innerHTML = `
      <div class="card-main">
        <p class="card-title"></p>
        <p class="card-subtitle">${w.sequences.length} séquence(s) · ${totalSeq} étape(s) au total</p>
      </div>
      <div class="card-actions">
        <button data-action="edit" title="Modifier">✏️</button>
        <button data-action="start" title="Lancer">▶️</button>
      </div>
    `;
    li.querySelector(".card-title").textContent = w.name || "Entraînement sans nom";
    li.querySelector('[data-action="edit"]').addEventListener("click", () => openEditor(w));
    li.querySelector('[data-action="start"]').addEventListener("click", () => {
      if (w.sequences.length === 0) {
        alert("Ajoute au moins une séquence avant de lancer cet entraînement.");
        return;
      }
      startPlayer(w);
    });
    list.appendChild(li);
  }
}

function openEditor(workout) {
  currentWorkout = workout;
  el["workout-name"].value = workout.name;
  showView("view-editor");
  renderSequenceList();
}

function renderSequenceList() {
  const list = el["sequence-list"];
  list.innerHTML = "";
  el["sequence-empty-state"].hidden = currentWorkout.sequences.length > 0;

  currentWorkout.sequences.forEach((seq, idx) => {
    const li = document.createElement("li");
    li.className = "card";
    li.innerHTML = `
      <div class="card-main">
        <p class="card-title"></p>
        <p class="card-subtitle"></p>
      </div>
      <div class="card-actions">
        <button data-action="up" title="Monter" ${idx === 0 ? "disabled" : ""}>↑</button>
        <button data-action="down" title="Descendre" ${idx === currentWorkout.sequences.length - 1 ? "disabled" : ""}>↓</button>
        <button data-action="duplicate" title="Dupliquer">⧉</button>
        <button data-action="edit" title="Modifier">✏️</button>
        <button data-action="delete" title="Supprimer">🗑️</button>
      </div>
    `;
    const typeLabel = { time: "⏱", distance: "📏" }[seq.metricType];
    const speedSuffix = seq.speedEnabled ? " ⚡" : "";
    li.querySelector(".card-title").textContent = `${typeLabel} ${seq.name || "Séquence " + (idx + 1)}${speedSuffix}`;
    li.querySelector(".card-subtitle").textContent = summarizeSequence(seq);

    li.querySelector('[data-action="up"]').addEventListener("click", () => moveSequence(idx, -1));
    li.querySelector('[data-action="down"]').addEventListener("click", () => moveSequence(idx, 1));
    li.querySelector('[data-action="duplicate"]').addEventListener("click", () => {
      currentWorkout.sequences.splice(idx + 1, 0, duplicateSequence(seq));
      persist();
      renderSequenceList();
    });
    li.querySelector('[data-action="edit"]').addEventListener("click", () => openSequenceDialog(seq));
    li.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (confirm("Supprimer cette séquence ?")) {
        currentWorkout.sequences.splice(idx, 1);
        persist();
        renderSequenceList();
      }
    });
    list.appendChild(li);
  });
}

function saveHistoryEntry(summary) {
  const history = loadHistory();
  history.unshift({ id: uid(), ...summary });
  saveHistory(history);
}

function renderHistoryList() {
  const list = el["history-list"];
  list.innerHTML = "";
  const history = loadHistory();
  el["history-empty-state"].hidden = history.length > 0;

  for (const entry of history) {
    const li = document.createElement("li");
    li.className = "card";
    li.innerHTML = `
      <div class="card-main">
        <p class="card-title"></p>
        <p class="card-subtitle"></p>
      </div>
      <div class="card-actions">
        <button data-action="delete" title="Supprimer">🗑️</button>
      </div>
    `;
    li.querySelector(".card-title").textContent =
      `${entry.workoutName || "Entraînement sans nom"} — ${formatDateTime(entry.startedAt)}`;
    const badgeClass = entry.completed ? "completed" : "interrupted";
    const badgeLabel = entry.completed ? "Terminé" : "Interrompu";
    li.querySelector(".card-subtitle").innerHTML =
      `${formatMmSs(entry.durationSec)} · ${Math.round(entry.achievementRatio * 100)}% des objectifs · ` +
      `<span class="history-badge ${badgeClass}">${badgeLabel}</span>`;
    li.querySelector('[data-action="delete"]').addEventListener("click", () => {
      saveHistory(loadHistory().filter((h) => h.id !== entry.id));
      renderHistoryList();
    });
    list.appendChild(li);
  }
}

function moveSequence(idx, delta) {
  const target = idx + delta;
  if (target < 0 || target >= currentWorkout.sequences.length) return;
  const arr = currentWorkout.sequences;
  [arr[idx], arr[target]] = [arr[target], arr[idx]];
  persist();
  renderSequenceList();
}

function setSequenceTypeFields(type) {
  el["fields-time"].hidden = type !== "time";
  el["fields-distance"].hidden = type !== "distance";
}

function openSequenceDialog(seq) {
  editingSequenceId = seq ? seq.id : null;
  const s = seq || newSequence();

  el["seq-name"].value = s.name;
  el["seq-start-sound"].checked = s.playStartSound;
  el["sequence-form"].querySelector(`input[name="seq-type"][value="${s.metricType}"]`).checked = true;
  setSequenceTypeFields(s.metricType);

  el["seq-time-duration"].value = formatMmSs(s.durationSec);
  el["seq-time-voice-mode"].value = s.voiceAlertMode;

  el["seq-distance-value"].value = s.distanceM;
  el["seq-distance-voice-mode"].value = s.voiceAlertMode;

  el["seq-speed-enabled"].checked = s.speedEnabled;
  el["fields-speed-option"].hidden = !s.speedEnabled;
  el["seq-speed-target"].value = s.targetSpeedKmh;
  el["seq-speed-tolerance"].value = Math.round(s.toleranceRatio * 100);

  el["seq-repetitions"].value = s.repetitions;

  el["sequence-dialog"].showModal();
}

function collectSequenceFromForm() {
  const type = el["sequence-form"].querySelector('input[name="seq-type"]:checked').value;
  const base = {
    id: editingSequenceId || uid(),
    name: el["seq-name"].value.trim(),
    playStartSound: el["seq-start-sound"].checked,
    metricType: type,
    repetitions: Math.max(1, parseInt(el["seq-repetitions"].value, 10) || 1),
    durationSec: 30,
    distanceM: 200,
    voiceAlertMode: "none",
    alertLeadSec: 10,
    alertLeadM: 50,
    speedEnabled: el["seq-speed-enabled"].checked,
    targetSpeedKmh: Math.max(0.1, parseFloat(el["seq-speed-target"].value) || 1),
    toleranceRatio: Math.max(0, (parseFloat(el["seq-speed-tolerance"].value) || 0) / 100),
  };

  if (type === "time") {
    base.durationSec = Math.max(1, parseMmSs(el["seq-time-duration"].value));
    base.voiceAlertMode = el["seq-time-voice-mode"].value;
  } else if (type === "distance") {
    base.distanceM = Math.max(1, parseInt(el["seq-distance-value"].value, 10) || 1);
    base.voiceAlertMode = el["seq-distance-voice-mode"].value;
  }

  return base;
}

function startPlayer(workout) {
  unlockAudio();
  currentWorkout = workout;
  showView("view-player");
  el["btn-player-pause"].textContent = "⏸ Pause";

  player = new WorkoutPlayer(workout, {
    onStepStart: (step, index, total) => {
      el["player-step-index"].textContent = `Étape ${index + 1}/${total}`;
      el["player-step-name"].textContent = describeStep(step);
      el["player-progress-fill"].style.width = "0%";
    },
    onTick: (info) => updatePlayerReadout(info),
    onGpsStatus: (status) => {
      el["player-gps-status"].textContent = status ? `GPS : ${status}` : "";
    },
    onComplete: () => {
      saveHistoryEntry(player.getSummary());
      showView("view-list");
      renderWorkoutList();
    },
  });
  player.start();
}

/** Demande confirmation pour arrêter la séance en cours, puis propose de l'enregistrer. */
function stopPlayerWithConfirm() {
  if (!player) return;
  if (!confirm("Arrêter l'entraînement en cours ?")) return;
  const summary = player.getSummary();
  player.stop();
  if (confirm("Enregistrer cette séance dans l'historique ?")) {
    saveHistoryEntry(summary);
  }
  showView("view-list");
  renderWorkoutList();
}

function updatePlayerReadout(info) {
  el["player-progress-fill"].style.width = `${Math.max(0, Math.min(1, info.progress || 0)) * 100}%`;
  el["player-next-step"].textContent = info.nextStepLabel ? `Suivant : ${info.nextStepLabel}` : "Dernière étape";

  const speedNote = info.speedEnabled
    ? `${info.currentSpeedKmh.toFixed(1)} km/h (cible ${info.targetSpeedKmh} km/h)`
    : "";

  if (info.metricType === "time") {
    el["player-big-readout"].textContent = formatMmSs(info.remainingSec);
    el["player-sub-readout"].textContent = speedNote;
  } else if (info.metricType === "distance") {
    el["player-big-readout"].textContent = formatDistance(info.distanceM);
    el["player-sub-readout"].textContent = `Objectif ${formatDistance(info.targetDistanceM)}` + (speedNote ? ` · ${speedNote}` : "");
  }
}

function wireEvents() {
  el["btn-back"].addEventListener("click", () => {
    if (!el["view-player"].hidden) {
      stopPlayerWithConfirm();
      return;
    }
    persist();
    showView("view-list");
    renderWorkoutList();
  });

  el["btn-new-workout"].addEventListener("click", () => {
    const w = newWorkout();
    workouts.push(w);
    persist();
    openEditor(w);
  });

  el["btn-view-history"].addEventListener("click", () => {
    renderHistoryList();
    showView("view-history");
  });

  el["workout-name"].addEventListener("input", () => {
    currentWorkout.name = el["workout-name"].value;
    persist();
  });

  el["btn-add-sequence"].addEventListener("click", () => openSequenceDialog(null));

  el["btn-delete-workout"].addEventListener("click", () => {
    if (confirm("Supprimer définitivement cet entraînement ?")) {
      workouts = workouts.filter((w) => w.id !== currentWorkout.id);
      persist();
      showView("view-list");
      renderWorkoutList();
    }
  });

  el["btn-start-workout"].addEventListener("click", () => {
    if (currentWorkout.sequences.length === 0) {
      alert("Ajoute au moins une séquence avant de lancer cet entraînement.");
      return;
    }
    startPlayer(currentWorkout);
  });

  el["sequence-form"].querySelectorAll('input[name="seq-type"]').forEach((radio) => {
    radio.addEventListener("change", (e) => setSequenceTypeFields(e.target.value));
  });

  el["seq-speed-enabled"].addEventListener("change", (e) => {
    el["fields-speed-option"].hidden = !e.target.checked;
  });

  el["sequence-dialog"].addEventListener("close", () => {
    if (el["sequence-dialog"].returnValue !== "save") return;
    const seq = collectSequenceFromForm();
    const idx = currentWorkout.sequences.findIndex((s) => s.id === seq.id);
    if (idx >= 0) currentWorkout.sequences[idx] = seq;
    else currentWorkout.sequences.push(seq);
    persist();
    renderSequenceList();
  });

  el["btn-player-pause"].addEventListener("click", () => {
    if (!player) return;
    if (player.paused) {
      player.resume();
      el["btn-player-pause"].textContent = "⏸ Pause";
    } else {
      player.pause();
      el["btn-player-pause"].textContent = "▶ Reprendre";
    }
  });

  el["btn-player-stop"].addEventListener("click", () => {
    stopPlayerWithConfirm();
  });
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

function setupInstallPrompt() {
  if (isStandalone()) return; // déjà installée, rien à proposer

  if (isIos()) {
    el["ios-install-hint"].hidden = false;
    return;
  }

  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    el["btn-install-app"].hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    el["btn-install-app"].hidden = true;
  });

  el["btn-install-app"].addEventListener("click", async () => {
    if (!deferredPrompt) return;
    el["btn-install-app"].hidden = true;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });
}

export function initUI() {
  for (const id of ids) el[id] = document.getElementById(id);
  wireEvents();
  setupInstallPrompt();
  showView("view-list");
  renderWorkoutList();
}
