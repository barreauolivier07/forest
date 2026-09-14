import { initUI } from "./ui.js";

initUI();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Échec de l'enregistrement du service worker :", err);
    });
  });
}
