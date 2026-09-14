// Suivi GPS : distance parcourue et vitesse instantanée, via l'API Geolocation du téléphone.
// Ne nécessite pas de connexion internet (le récepteur GPS fonctionne hors-ligne), mais
// nécessite : un accord de permission, un usage en extérieur, et un contexte sécurisé
// (https, ou localhost en développement).

const MAX_ACCURACY_M = 30; // ignore les points trop imprécis
const MAX_PLAUSIBLE_SPEED_MS = 12.5; // ~45 km/h, filtre les sauts GPS aberrants

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function isGeolocationSupported() {
  return "geolocation" in navigator;
}

export class GpsTracker {
  /**
   * @param {(state: {distanceM: number, speedKmh: number, status: string}) => void} onUpdate
   */
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.watchId = null;
    this.lastPoint = null; // {lat, lon, t}
    this.distanceM = 0;
    this.speedKmh = 0;
    this.paused = false;
  }

  start() {
    if (!isGeolocationSupported()) {
      this.onUpdate({ distanceM: this.distanceM, speedKmh: 0, status: "indisponible" });
      return;
    }
    this.onUpdate({ distanceM: this.distanceM, speedKmh: 0, status: "recherche du signal…" });
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._handlePosition(pos),
      (err) => this._handleError(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) this.lastPoint = null; // évite un grand saut de distance à la reprise
  }

  reset() {
    this.distanceM = 0;
    this.speedKmh = 0;
    this.lastPoint = null;
  }

  stop() {
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.lastPoint = null;
  }

  _handlePosition(pos) {
    const { latitude, longitude, accuracy, speed } = pos.coords;
    const t = pos.timestamp;

    if (accuracy != null && accuracy > MAX_ACCURACY_M) {
      this.onUpdate({
        distanceM: this.distanceM,
        speedKmh: this.speedKmh,
        status: `signal imprécis (±${Math.round(accuracy)} m)`,
      });
      return;
    }

    if (speed != null && speed >= 0) {
      this.speedKmh = speed * 3.6;
    }

    if (this.lastPoint && !this.paused) {
      const dt = (t - this.lastPoint.t) / 1000;
      const d = haversineMeters(this.lastPoint.lat, this.lastPoint.lon, latitude, longitude);
      if (dt > 0 && d / dt <= MAX_PLAUSIBLE_SPEED_MS) {
        this.distanceM += d;
        if (speed == null) this.speedKmh = (d / dt) * 3.6;
      }
    }

    this.lastPoint = { lat: latitude, lon: longitude, t };

    this.onUpdate({
      distanceM: this.distanceM,
      speedKmh: this.speedKmh,
      status: `signal ok (±${Math.round(accuracy || 0)} m)`,
    });
  }

  _handleError(err) {
    let status = "erreur GPS";
    if (err.code === err.PERMISSION_DENIED) status = "position refusée";
    else if (err.code === err.TIMEOUT) status = "signal introuvable";
    this.onUpdate({ distanceM: this.distanceM, speedKmh: this.speedKmh, status });
  }
}
