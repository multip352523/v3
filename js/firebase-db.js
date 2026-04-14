/* =============================================
   FIREBASE.JS — Real-time Database Layer
   সব ডিভাইসে লাইভ সিঙ্ক
   =============================================

   ⚠️  SETUP: নিচের firebaseConfig-এ আপনার
   Firebase প্রজেক্টের তথ্য দিন।
   Firebase Console: https://console.firebase.google.com
   ============================================= */

const FIREBASE_CONFIG = {
  // 👇 এখানে আপনার Firebase config দিন
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

/* ---- Rate limit (local only, per device) ---- */
const RATE_KEY   = 'policeAlert_rate';
const VOTED_KEY  = 'policeAlert_voted';
const RATE_LIMIT = 10;
const RATE_WIN   = 3600000;

/* =============================================
   FirebaseDB — Realtime Database wrapper
   ============================================= */
const FirebaseDB = (() => {
  let db = null;
  let markersRef = null;
  let _listeners = [];

  /* ---------- INIT ---------- */
  async function init() {
    // Firebase SDKs loaded via <script> in index.html
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    markersRef = db.ref('markers');
    console.log('[Firebase] Connected');
  }

  /* ---------- LISTEN (real-time) ---------- */
  function onMarkersChange(callback) {
    if (!markersRef) return;
    markersRef.on('value', snapshot => {
      const raw = snapshot.val() || {};
      const markers = Object.values(raw);
      callback(markers);
    });
  }

  function onMarkerAdded(callback) {
    if (!markersRef) return;
    markersRef.on('child_added', snap => callback(snap.val()));
  }

  function onMarkerRemoved(callback) {
    if (!markersRef) return;
    markersRef.on('child_removed', snap => callback(snap.key));
  }

  function onMarkerChanged(callback) {
    if (!markersRef) return;
    markersRef.on('child_changed', snap => callback(snap.val()));
  }

  /* ---------- WRITE ---------- */
  async function addMarker(marker) {
    if (!markersRef) return false;
    await markersRef.child(marker.id).set(marker);
    return true;
  }

  async function updateMarker(id, updates) {
    if (!markersRef) return false;
    await markersRef.child(id).update(updates);
    return true;
  }

  async function removeMarker(id) {
    if (!markersRef) return false;
    await markersRef.child(id).remove();
    return true;
  }

  async function clearAll() {
    if (!markersRef) return false;
    await markersRef.remove();
    return true;
  }

  /* ---------- READ (once) ---------- */
  async function getAllMarkers() {
    if (!markersRef) return [];
    const snap = await markersRef.once('value');
    const raw = snap.val() || {};
    return Object.values(raw);
  }

  /* ---------- RATE LIMIT (local) ---------- */
  function canAdd() {
    try {
      const raw = localStorage.getItem(RATE_KEY);
      const r = raw ? JSON.parse(raw) : { count: 0, start: Date.now() };
      if (Date.now() - r.start >= RATE_WIN) {
        localStorage.setItem(RATE_KEY, JSON.stringify({ count: 0, start: Date.now() }));
        return { ok: true, left: RATE_LIMIT };
      }
      const left = RATE_LIMIT - r.count;
      return { ok: left > 0, left: Math.max(0, left) };
    } catch { return { ok: true, left: RATE_LIMIT }; }
  }

  function bumpRate() {
    try {
      const raw = localStorage.getItem(RATE_KEY);
      const r = raw ? JSON.parse(raw) : { count: 0, start: Date.now() };
      if (Date.now() - r.start >= RATE_WIN) {
        localStorage.setItem(RATE_KEY, JSON.stringify({ count: 1, start: Date.now() }));
      } else {
        localStorage.setItem(RATE_KEY, JSON.stringify({ count: r.count + 1, start: r.start }));
      }
    } catch {}
  }

  /* ---------- VOTE TRACKING (local) ---------- */
  function hasVoted(id) {
    try {
      const v = JSON.parse(localStorage.getItem(VOTED_KEY) || '{}');
      return !!v[id];
    } catch { return false; }
  }

  function setVoted(id) {
    try {
      const v = JSON.parse(localStorage.getItem(VOTED_KEY) || '{}');
      v[id] = Date.now();
      localStorage.setItem(VOTED_KEY, JSON.stringify(v));
    } catch {}
  }

  /* ---------- EXPORT ---------- */
  async function exportData() {
    const markers = await getAllMarkers();
    return { markers, exportedAt: new Date().toISOString(), version: '2.0' };
  }

  async function importData(jsonText) {
    try {
      const data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
      if (!Array.isArray(data.markers)) return false;
      for (const m of data.markers) {
        await markersRef.child(m.id).set(m);
      }
      return true;
    } catch { return false; }
  }

  return {
    init,
    onMarkersChange,
    onMarkerAdded,
    onMarkerRemoved,
    onMarkerChanged,
    addMarker,
    updateMarker,
    removeMarker,
    clearAll,
    getAllMarkers,
    canAdd,
    bumpRate,
    hasVoted,
    setVoted,
    exportData,
    importData,
    isReady: () => !!db,
  };
})();
