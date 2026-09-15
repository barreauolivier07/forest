import {
  loadWorkouts,
  saveWorkouts,
  newSequence,
  newWorkout,
  duplicateSequence,
  loadHistory,
  saveHistory,
  loadSettings,
  saveSettings,
  uid,
} from "./storage.js";
import { unlockAudio, applyAudioSettings, previewVoice, speak } from "./audio.js";
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
let currentViewName = "view-menu";
// Capturées au clic sur "Enregistrer" : une fois le dialogue fermé, les rouleaux masqués
// perdent leur position de défilement, donc on lit leur valeur avant la fermeture.
let pendingDurationSec = 30;
let pendingAlertLeadSec = 10;

const el = {};
const ids = [
  "header-title", "btn-back",
  "view-menu", "btn-install-app", "ios-install-hint", "install-success", "app-version",
  "menu-btn-history", "menu-btn-launch", "menu-btn-manage", "menu-btn-compose",
  "view-history", "history-list", "history-empty-state",
  "view-launch-list", "launch-list", "launch-empty-state",
  "view-manage-list", "manage-list", "manage-empty-state",
  "view-editor", "workout-name", "sequence-list", "sequence-empty-state",
  "btn-add-sequence", "btn-start-workout", "btn-delete-workout",
  "view-player", "player-gps-status", "player-steps-list",
  "btn-player-pause", "btn-player-stop",
  "sequence-dialog", "sequence-form", "seq-name", "seq-start-sound", "btn-save-sequence",
  "btn-seq-help-toggle", "seq-help-banner",
  "fields-time", "fields-distance",
  "seq-distance-value", "seq-distance-voice-mode",
  "seq-speed-enabled", "fields-speed-option", "seq-speed-target", "seq-speed-tolerance",
  "seq-repetitions",
  "btn-settings", "settings-dialog", "settings-form", "settings-full-fields",
  "set-volume", "set-firstname", "btn-share-app",
];

const MMSS_ITEM_HEIGHT = 40;

/** Construit les 60 valeurs (00-59) de chaque colonne d'un sélecteur à rouleaux. */
function buildMmSsPicker(pickerId) {
  const picker = document.getElementById(pickerId);
  picker.querySelectorAll(".mmss-col").forEach((col) => {
    col.innerHTML = "";
    col.appendChild(Object.assign(document.createElement("div"), { className: "mmss-pad" }));
    for (let i = 0; i < 60; i++) {
      const item = document.createElement("div");
      item.className = "mmss-item";
      item.textContent = String(i).padStart(2, "0");
      col.appendChild(item);
    }
    col.appendChild(Object.assign(document.createElement("div"), { className: "mmss-pad" }));
  });
}

function setMmSsPickerValue(pickerId, totalSeconds) {
  const picker = document.getElementById(pickerId);
  const min = Math.max(0, Math.min(59, Math.floor(totalSeconds / 60)));
  const sec = Math.max(0, Math.min(59, Math.floor(totalSeconds % 60)));
  picker.querySelector('.mmss-col[data-unit="min"]').scrollTop = min * MMSS_ITEM_HEIGHT;
  picker.querySelector('.mmss-col[data-unit="sec"]').scrollTop = sec * MMSS_ITEM_HEIGHT;
}

function getMmSsPickerValue(pickerId) {
  const picker = document.getElementById(pickerId);
  const min = picker.querySelector('.mmss-col[data-unit="min"]');
  const sec = picker.querySelector('.mmss-col[data-unit="sec"]');
  const minVal = Math.max(0, Math.min(59, Math.round(min.scrollTop / MMSS_ITEM_HEIGHT)));
  const secVal = Math.max(0, Math.min(59, Math.round(sec.scrollTop / MMSS_ITEM_HEIGHT)));
  return minVal * 60 + secVal;
}

function persist() {
  saveWorkouts(workouts);
}

// À incrémenter à chaque déploiement, en même temps que CACHE_NAME dans service-worker.js —
// affiché en bas de la page d'accueil pour vérifier facilement qu'une mise à jour est bien
// arrivée sur un téléphone donné.
const APP_VERSION = "18";

const APP_TITLE = "Forest, le compositeur de séances";

const VIEW_TITLES = {
  "view-menu": APP_TITLE,
  "view-history": "Historique des séances",
  "view-launch-list": "Les séances types",
  "view-manage-list": "Les séances types",
  "view-editor": "Type de séance",
  "view-player": "Séance en cours",
};

// Page précédente vers laquelle revenir depuis chaque vue (view-editor et view-player
// sont gérés au cas par cas : le premier dépend de l'état de la séquence, le second n'a
// pas de bouton retour du tout).
const BACK_TARGETS = {
  "view-history": "view-menu",
  "view-launch-list": "view-menu",
  "view-manage-list": "view-menu",
};

function showView(name) {
  Object.keys(VIEW_TITLES).forEach((id) => {
    el[id].hidden = id !== name;
  });
  currentViewName = name;
  el["btn-back"].hidden = name === "view-menu" || name === "view-player";
  el["header-title"].textContent = VIEW_TITLES[name] || APP_TITLE;
}

function editorTitleFor(workout) {
  return workout.sequences.length === 0
    ? "Création d'un type de séance"
    : "Modifier la séance type";
}

/** Un type de séance n'est conservé que s'il contient au moins une séquence. */
function syncCurrentWorkout() {
  if (!currentWorkout) return;
  const idx = workouts.findIndex((w) => w.id === currentWorkout.id);
  if (currentWorkout.sequences.length > 0) {
    if (idx === -1) workouts.push(currentWorkout);
    persist();
  } else if (idx !== -1) {
    workouts.splice(idx, 1);
    persist();
  }
}

function formatDateTime(timestamp) {
  const d = new Date(timestamp);
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

/** Rendu partagé pour les deux listes de séances type ('launch' : ▶️ seul, 'manage' : ✏️ seul). */
function renderWorkoutCards(listEl, emptyEl, mode) {
  listEl.innerHTML = "";
  emptyEl.hidden = workouts.length > 0;

  for (const w of workouts) {
    const li = document.createElement("li");
    li.className = "card";
    const totalSeq = w.sequences.reduce((n, s) => n + (s.repetitions || 1), 0);
    const actionHtml =
      mode === "launch"
        ? '<button data-action="start" title="Lancer">▶️</button>'
        : '<button data-action="edit" title="Modifier">✏️</button>';
    li.innerHTML = `
      <div class="card-main">
        <p class="card-title"></p>
        <p class="card-subtitle">${w.sequences.length} séquence(s) · ${totalSeq} étape(s) au total</p>
      </div>
      <div class="card-actions">${actionHtml}</div>
    `;
    li.querySelector(".card-title").textContent = w.name || "Entraînement sans nom";

    if (mode === "launch") {
      li.querySelector('[data-action="start"]').addEventListener("click", () => {
        if (w.sequences.length === 0) {
          alert("Ajoute au moins une séquence avant de lancer cet entraînement.");
          return;
        }
        startPlayer(w);
      });
    } else {
      li.querySelector('[data-action="edit"]').addEventListener("click", () => openEditor(w));
    }
    listEl.appendChild(li);
  }
}

function renderLaunchList() {
  renderWorkoutCards(el["launch-list"], el["launch-empty-state"], "launch");
}

function renderManageList() {
  renderWorkoutCards(el["manage-list"], el["manage-empty-state"], "manage");
}

function openEditor(workout) {
  currentWorkout = workout;
  el["workout-name"].value = workout.name;
  showView("view-editor");
  el["header-title"].textContent = editorTitleFor(workout);
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
      syncCurrentWorkout();
      renderSequenceList();
    });
    li.querySelector('[data-action="edit"]').addEventListener("click", () => openSequenceDialog(seq));
    li.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (confirm("Supprimer cette séquence ?")) {
        currentWorkout.sequences.splice(idx, 1);
        syncCurrentWorkout();
        renderSequenceList();
      }
    });
    list.appendChild(li);
  });

  const hasSequences = currentWorkout.sequences.length > 0;
  el["btn-start-workout"].hidden = !hasSequences;
  el["btn-delete-workout"].hidden = !hasSequences;
  if (!el["view-editor"].hidden) {
    el["header-title"].textContent = editorTitleFor(currentWorkout);
  }
}

function saveHistoryEntry(summary) {
  const history = loadHistory();
  history.unshift({ id: uid(), ...summary });
  saveHistory(history);
}

function buildHistoryStepLi(step, index) {
  const li = document.createElement("li");

  const nameDiv = document.createElement("div");
  nameDiv.className = "history-step-name";
  nameDiv.textContent = `${index + 1}. ${step.name}`;
  li.appendChild(nameDiv);

  const metaDiv = document.createElement("div");
  metaDiv.className = "history-step-meta";
  const planned =
    step.metricType === "time" ? formatMmSs(step.plannedDurationSec) : formatDistance(step.plannedDistanceM);
  const statusLabel = step.completed ? "Terminé" : "Interrompu";
  let metaText =
    `Prévu ${planned} · Réalisé ${formatMmSs(step.durationSec)} · ` +
    `${Math.round(step.achievementRatio * 100)}% · ${statusLabel}`;
  if (step.speedComplianceRatio != null) {
    metaText += ` · ⚡ ${Math.round(step.speedComplianceRatio * 100)}% dans la cible`;
  }
  metaDiv.textContent = metaText;
  li.appendChild(metaDiv);

  return li;
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
    const speedLine =
      entry.speedComplianceRatio != null
        ? `<p class="card-subtitle">⚡ Respect de la vitesse cible : ${Math.round(entry.speedComplianceRatio * 100)}%</p>`
        : "";
    li.querySelector(".card-subtitle").outerHTML =
      `<p class="card-subtitle">${formatMmSs(entry.durationSec)} · ${Math.round(entry.achievementRatio * 100)}% des objectifs · ` +
      `<span class="history-badge ${badgeClass}">${badgeLabel}</span></p>${speedLine}`;

    if (entry.steps && entry.steps.length > 0) {
      const details = document.createElement("details");
      details.className = "history-details";
      const summary = document.createElement("summary");
      summary.textContent = "Détail des séquences";
      details.appendChild(summary);
      const stepsList = document.createElement("ul");
      stepsList.className = "history-steps";
      entry.steps.forEach((step, i) => stepsList.appendChild(buildHistoryStepLi(step, i)));
      details.appendChild(stepsList);
      li.querySelector(".card-main").appendChild(details);
    }

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
  syncCurrentWorkout();
  renderSequenceList();
}

function setSequenceTypeFields(type) {
  el["fields-time"].hidden = type !== "time";
  el["fields-distance"].hidden = type !== "distance";
}

const HELP_TEXTS = {
  "seq-name": "Donne un nom à cette séquence, par exemple Sprint ou Récupération. C'est facultatif.",
  "seq-start-sound": "Active cette option pour entendre un signal sonore au démarrage de la séquence.",
  "seq-type": "Choisis si cette séquence se termine après un temps donné, ou après une distance parcourue.",
  "picker-time-duration": "Règle la durée de la séquence en faisant défiler les minutes et les secondes.",
  "picker-time-alert": "Règle combien de temps avant la fin une annonce vocale te prévient. Mets zéro zéro pour ne recevoir aucune alerte.",
  "seq-distance-value": "Indique la distance à parcourir, en mètres.",
  "seq-distance-voice-mode": "Choisis si une annonce vocale te prévient juste avant la fin de la distance.",
  "seq-speed-enabled": "Active cette option si tu veux maintenir une vitesse cible pendant cette séquence, avec des encouragements vocaux.",
  "seq-speed-target": "Indique la vitesse à maintenir, en kilomètres heure.",
  "seq-speed-tolerance": "Définis la marge de tolérance autour de la vitesse cible, en pourcentage.",
  "seq-repetitions": "Indique combien de fois cette séquence doit se répéter d'affilée.",
};

let lastHelpFieldEl = null;

function triggerHelp(key, fieldEl) {
  if (!loadSettings().sequenceHelpEnabled) return;
  const text = HELP_TEXTS[key];
  if (!text) return;

  if (lastHelpFieldEl) lastHelpFieldEl.classList.remove("field-help-active");
  const wrap = fieldEl ? fieldEl.closest(".field") : null;
  if (wrap) wrap.classList.add("field-help-active");
  lastHelpFieldEl = wrap;

  el["seq-help-banner"].textContent = text;
  el["seq-help-banner"].hidden = false;
  speak(text);
}

function wireHelpTriggers() {
  const focusKeys = [
    "seq-name", "seq-start-sound", "seq-distance-value", "seq-distance-voice-mode",
    "seq-speed-enabled", "seq-speed-target", "seq-speed-tolerance", "seq-repetitions",
  ];
  for (const key of focusKeys) {
    el[key].addEventListener("focus", () => triggerHelp(key, el[key]));
  }

  el["sequence-form"].querySelectorAll('input[name="seq-type"]').forEach((radio) => {
    radio.addEventListener("focus", () => triggerHelp("seq-type", radio));
  });

  for (const pickerId of ["picker-time-duration", "picker-time-alert"]) {
    const picker = document.getElementById(pickerId);
    picker.addEventListener("pointerdown", () => triggerHelp(pickerId, picker));
  }

  el["btn-seq-help-toggle"].addEventListener("click", () => {
    const settings = loadSettings();
    settings.sequenceHelpEnabled = !settings.sequenceHelpEnabled;
    saveSettings(settings);
    el["btn-seq-help-toggle"].setAttribute("aria-pressed", String(settings.sequenceHelpEnabled));
    if (!settings.sequenceHelpEnabled) {
      el["seq-help-banner"].hidden = true;
      if (lastHelpFieldEl) lastHelpFieldEl.classList.remove("field-help-active");
      lastHelpFieldEl = null;
    } else {
      el["seq-help-banner"].textContent = "Touche un champ pour que je t'explique à quoi il sert.";
      el["seq-help-banner"].hidden = false;
      speak("Aide activée. Touche un champ pour que je t'explique à quoi il sert.");
    }
  });
}

function openSequenceDialog(seq) {
  editingSequenceId = seq ? seq.id : null;
  const s = seq || newSequence();

  el["seq-name"].value = s.name;
  el["seq-start-sound"].checked = s.playStartSound;
  el["sequence-form"].querySelector(`input[name="seq-type"][value="${s.metricType}"]`).checked = true;
  setSequenceTypeFields(s.metricType);

  el["seq-distance-value"].value = s.distanceM;
  el["seq-distance-voice-mode"].value = s.voiceAlertMode;

  el["seq-speed-enabled"].checked = s.speedEnabled;
  el["fields-speed-option"].hidden = !s.speedEnabled;
  el["seq-speed-target"].value = s.targetSpeedKmh;
  el["seq-speed-tolerance"].value = Math.round(s.toleranceRatio * 100);

  el["seq-repetitions"].value = s.repetitions;

  const helpEnabled = loadSettings().sequenceHelpEnabled;
  el["btn-seq-help-toggle"].setAttribute("aria-pressed", String(helpEnabled));
  if (lastHelpFieldEl) lastHelpFieldEl.classList.remove("field-help-active");
  lastHelpFieldEl = null;
  if (helpEnabled) {
    el["seq-help-banner"].textContent = "Touche un champ pour que je t'explique à quoi il sert.";
    el["seq-help-banner"].hidden = false;
  } else {
    el["seq-help-banner"].hidden = true;
  }

  // les rouleaux doivent être visibles (dialogue ouvert) pour que le positionnement du
  // défilement soit pris en compte par le navigateur.
  el["sequence-dialog"].showModal();
  setMmSsPickerValue("picker-time-duration", s.durationSec);
  setMmSsPickerValue("picker-time-alert", s.voiceAlertMode === "none" ? 0 : s.alertLeadSec || 10);
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
    base.durationSec = Math.max(1, pendingDurationSec);
    base.alertLeadSec = pendingAlertLeadSec;
    base.voiceAlertMode = pendingAlertLeadSec > 0 ? "beforeEnd" : "none";
  } else if (type === "distance") {
    base.distanceM = Math.max(1, parseInt(el["seq-distance-value"].value, 10) || 1);
    base.voiceAlertMode = el["seq-distance-voice-mode"].value;
  }

  return base;
}

/** Texte d'info d'un pavé pour une séquence à venir (pas encore démarrée). */
function upcomingTileDetail(seq) {
  const parts = [];
  parts.push(seq.metricType === "time" ? `⏱ ${formatMmSs(seq.durationSec)}` : `📏 ${formatDistance(seq.distanceM)}`);
  if (seq.speedEnabled) parts.push(`⚡ cible ${seq.targetSpeedKmh} km/h`);
  return parts.join(" · ");
}

/** Texte d'info d'un pavé une fois sa séquence terminée. */
function doneTileDetail(stat) {
  const parts = [`✓ ${formatMmSs(stat.durationSec)}`];
  if (stat.speedComplianceRatio != null) {
    parts.push(`⚡ ${Math.round(stat.speedComplianceRatio * 100)}% dans la cible`);
  }
  return parts.join(" · ");
}

/** Construit la liste (une fois) des pavés représentant toute la séance à venir. */
function renderStepTiles(steps) {
  const list = el["player-steps-list"];
  list.innerHTML = "";
  steps.forEach((step) => {
    const li = document.createElement("li");
    li.className = "step-tile state-upcoming";
    li.innerHTML = `
      <div class="step-tile-fill"></div>
      <div class="step-tile-content">
        <div class="step-tile-header">
          <span class="step-tile-name"></span>
          <span class="step-tile-percent"></span>
        </div>
        <div class="step-tile-detail"></div>
      </div>
    `;
    li.querySelector(".step-tile-name").textContent = describeStep(step);
    li.querySelector(".step-tile-detail").textContent = upcomingTileDetail(step.sequence);
    list.appendChild(li);
  });
}

/** Marque le pavé d'index `index` comme terminé, avec ses statistiques réelles. */
function markTileDone(index) {
  const tile = el["player-steps-list"].children[index];
  const stat = player.stepStats[player.stepStats.length - 1];
  if (!tile || !stat) return;
  tile.className = "step-tile state-done";
  tile.querySelector(".step-tile-fill").style.width = "100%";
  tile.querySelector(".step-tile-percent").textContent = "✓";
  tile.querySelector(".step-tile-detail").textContent = doneTileDetail(stat);
}

function startPlayer(workout) {
  unlockAudio();
  currentWorkout = workout;
  showView("view-player");
  el["btn-player-pause"].textContent = "⏸ Pause";

  player = new WorkoutPlayer(workout, {
    onStepStart: (step, index) => {
      if (index > 0) markTileDone(index - 1);
      const tile = el["player-steps-list"].children[index];
      if (tile) {
        tile.className = "step-tile state-active";
        tile.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    },
    onTick: (info) => updatePlayerReadout(info),
    onGpsStatus: (status) => {
      el["player-gps-status"].textContent = status ? `GPS : ${status}` : "";
    },
    onComplete: () => {
      markTileDone(player.steps.length - 1);
      saveHistoryEntry(player.getSummary());
      showView("view-launch-list");
      renderLaunchList();
    },
  });
  renderStepTiles(player.steps);
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
    renderHistoryList();
    showView("view-history");
  } else {
    showView("view-menu");
  }
}

function updatePlayerReadout(info) {
  const tile = el["player-steps-list"].children[info.index];
  if (!tile) return;

  const fillPct = Math.max(0, Math.min(1, info.progress || 0)) * 100;
  tile.querySelector(".step-tile-fill").style.width = `${fillPct}%`;
  tile.querySelector(".step-tile-percent").textContent = `${Math.round(fillPct)}%`;

  const parts = [];
  if (info.metricType === "time") {
    parts.push(`⏱ ${formatMmSs(info.remainingSec)} restant`);
  } else if (info.metricType === "distance") {
    parts.push(`📏 ${formatDistance(info.distanceM)} / ${formatDistance(info.targetDistanceM)}`);
  }
  if (info.speedEnabled) {
    parts.push(`⚡ ${info.currentSpeedKmh.toFixed(1)} km/h (cible ${info.targetSpeedKmh} km/h)`);
  }
  tile.querySelector(".step-tile-detail").textContent = parts.join(" · ");
}

function wireEvents() {
  el["btn-back"].addEventListener("click", () => {
    if (currentViewName === "view-editor") {
      const hadSequences = currentWorkout.sequences.length > 0;
      syncCurrentWorkout(); // abandonne le type de séance s'il n'a aucune séquence
      if (hadSequences) {
        showView("view-manage-list");
        renderManageList();
      } else {
        showView("view-menu");
      }
      return;
    }
    const target = BACK_TARGETS[currentViewName] || "view-menu";
    showView(target);
    if (target === "view-launch-list") renderLaunchList();
    else if (target === "view-manage-list") renderManageList();
    else if (target === "view-history") renderHistoryList();
  });

  el["menu-btn-history"].addEventListener("click", () => {
    renderHistoryList();
    showView("view-history");
  });

  el["menu-btn-launch"].addEventListener("click", () => {
    renderLaunchList();
    showView("view-launch-list");
  });

  el["menu-btn-manage"].addEventListener("click", () => {
    renderManageList();
    showView("view-manage-list");
  });

  el["menu-btn-compose"].addEventListener("click", () => {
    openEditor(newWorkout()); // pas encore enregistré : il faut au moins une séquence
  });

  el["workout-name"].addEventListener("input", () => {
    currentWorkout.name = el["workout-name"].value;
    syncCurrentWorkout();
  });

  el["btn-add-sequence"].addEventListener("click", () => openSequenceDialog(null));

  el["btn-delete-workout"].addEventListener("click", () => {
    if (confirm("Supprimer définitivement cet entraînement ?")) {
      workouts = workouts.filter((w) => w.id !== currentWorkout.id);
      persist();
      showView("view-manage-list");
      renderManageList();
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

  el["btn-save-sequence"].addEventListener("click", () => {
    // le dialogue est encore ouvert ici : on capture les rouleaux avant qu'ils ne
    // soient masqués (et donc réinitialisés) par la fermeture du dialogue.
    pendingDurationSec = getMmSsPickerValue("picker-time-duration");
    pendingAlertLeadSec = getMmSsPickerValue("picker-time-alert");
  });

  el["sequence-dialog"].addEventListener("close", () => {
    if (el["sequence-dialog"].returnValue !== "save") return;
    const seq = collectSequenceFromForm();
    const idx = currentWorkout.sequences.findIndex((s) => s.id === seq.id);
    if (idx >= 0) currentWorkout.sequences[idx] = seq;
    else currentWorkout.sequences.push(seq);
    syncCurrentWorkout();
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

  el["btn-settings"].addEventListener("click", () => openSettingsDialog(currentViewName === "view-player"));

  let previewTimer = null;
  const previewNow = () => {
    const volume = parseFloat(el["set-volume"].value);
    const gender = el["settings-form"].querySelector('input[name="set-gender"]:checked').value;
    const name = el["set-firstname"].value.trim() || "Olivier";
    previewVoice(`Bonjour ${name}`, volume, gender);
  };
  el["set-volume"].addEventListener("input", () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(previewNow, 350);
  });
  el["settings-form"].querySelectorAll('input[name="set-gender"]').forEach((radio) => {
    radio.addEventListener("change", previewNow);
  });

  el["btn-share-app"].addEventListener("click", async () => {
    const shareData = {
      title: APP_TITLE,
      text: "Essaie Forest, mon app d'entraînements fractionnés !",
      url: location.origin + location.pathname,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        /* partage annulé par l'utilisateur, on ignore */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareData.url);
      alert("Le partage direct n'est pas disponible ici : le lien a été copié dans le presse-papiers.");
    } catch {
      alert(shareData.url);
    }
  });

  el["settings-dialog"].addEventListener("close", () => {
    if (el["settings-dialog"].returnValue !== "save") return;
    const previous = loadSettings();
    const settings = el["settings-full-fields"].hidden
      ? { ...previous, voiceVolume: parseFloat(el["set-volume"].value) }
      : {
          voiceVolume: parseFloat(el["set-volume"].value),
          firstName: el["set-firstname"].value.trim() || "Olivier",
          voiceGender: el["settings-form"].querySelector('input[name="set-gender"]:checked').value,
        };
    saveSettings(settings);
    applyAudioSettings(settings);
  });
}

function openSettingsDialog(limitedToVolume) {
  const settings = loadSettings();
  el["set-volume"].value = settings.voiceVolume;
  el["set-firstname"].value = settings.firstName;
  el["settings-form"].querySelector(`input[name="set-gender"][value="${settings.voiceGender}"]`).checked = true;
  el["settings-full-fields"].hidden = !!limitedToVolume;
  el["settings-dialog"].showModal();
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

const INSTALL_WELCOME_KEY = "forest.installWelcomeShown";

/** Affiche le message de confirmation d'installation, une seule fois (tous parcours confondus). */
function showInstallSuccess(text) {
  if (localStorage.getItem(INSTALL_WELCOME_KEY)) return;
  localStorage.setItem(INSTALL_WELCOME_KEY, "1");
  el["install-success"].textContent = text;
  el["install-success"].hidden = false;
}

function setupInstallPrompt() {
  if (isStandalone()) {
    // Safari (iPhone/iPad) ne déclenche aucun évènement "installation réussie" : c'est donc
    // ce tout premier lancement depuis l'icône de l'écran d'accueil qui sert de confirmation,
    // pour iOS comme pour tout autre navigateur arrivant ici en mode application installée.
    showInstallSuccess("✅ Te voilà sur l'application installée, prête à l'emploi !");
    return;
  }

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
    showInstallSuccess(
      "✅ Application installée ! Tu peux maintenant fermer cet onglet et la lancer depuis l'icône sur ton écran d'accueil."
    );
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
  applyAudioSettings(loadSettings());
  buildMmSsPicker("picker-time-duration");
  buildMmSsPicker("picker-time-alert");
  el["app-version"].textContent = `Forest, version ${APP_VERSION}`;
  wireEvents();
  wireHelpTriggers();
  setupInstallPrompt();
  showView("view-menu");
}
