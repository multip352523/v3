/* =============================================
   APP.JS — Police Alert Map
   Firebase Real-time + Fast Map Tiles
   ============================================= */
'use strict';

/* ==================== CONFIG ==================== */
const CONFIG = {
  DEFAULT_LAT:  23.8103,
  DEFAULT_LNG:  90.4125,
  DEFAULT_ZOOM: 13,
  WRONG_THRESHOLD: 5,

  // Fast tile providers (fallback chain)
  TILES: [
    {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attr: '&copy; <a href="https://carto.com">CARTO</a> &copy; <a href="https://openstreetmap.org">OSM</a>',
      maxZoom: 20,
    },
    {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }
  ],
};

const TYPES = {
  Police:    { label: 'পুলিশ',     color: '#E63946', bg: '#fff0f1', emoji: '👮' },
  Checkpost: { label: 'চেকপোস্ট',  color: '#2196F3', bg: '#e3f2fd', emoji: '🚧' },
  DB:        { label: 'ডিবি',       color: '#4CAF50', bg: '#e8f5e9', emoji: '🕵️' },
  Traffic:   { label: 'ট্রাফিক',   color: '#FF9800', bg: '#fff3e0', emoji: '🚦' },
};

/* ==================== STATE ==================== */
const S = {
  map: null,
  tileLayer: null,
  markers: {},       // id -> { data, lm }
  activeFilter: 'all',
  isAdding: false,
  pendingLatLng: null,
  selectedType: 'Police',
  userMarker: null,
  useFirebase: false,
  localData: [],     // fallback when no Firebase
};

/* ==================== UTILITIES ==================== */
function toBn(n) {
  return String(Math.round(n)).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]);
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return 'এইমাত্র';
  if (s < 3600)  return toBn(Math.floor(s/60)) + ' মিনিট আগে';
  if (s < 86400) return toBn(Math.floor(s/3600)) + ' ঘণ্টা আগে';
  return toBn(Math.floor(s/86400)) + ' দিন আগে';
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let _toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function setSplashStatus(msg) {
  const el = document.getElementById('splashStatus');
  if (el) el.textContent = msg;
}

function hideSplash() {
  const s = document.getElementById('splash');
  s.style.opacity = '0';
  s.style.transition = 'opacity 0.4s';
  setTimeout(() => s.style.display = 'none', 400);
  document.getElementById('app').style.display = 'flex';
}

function setLiveBadge(connected) {
  const el = document.getElementById('liveBadge');
  if (!el) return;
  if (connected) {
    el.textContent = '● লাইভ সিঙ্ক';
    el.style.color = '#4CAF50';
  } else {
    el.textContent = '● অফলাইন মোড';
    el.style.color = '#FF9800';
  }
}

/* ==================== LOCAL STORAGE FALLBACK ==================== */
const Local = {
  KEY: 'policeAlert_markers_v2',
  get() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; }
  },
  save(arr) {
    try { localStorage.setItem(this.KEY, JSON.stringify(arr)); } catch {}
  },
  add(m) {
    const arr = this.get(); arr.unshift(m); this.save(arr);
  },
  remove(id) {
    this.save(this.get().filter(m => m.id !== id));
  },
  update(id, patch) {
    const arr = this.get();
    const i = arr.findIndex(m => m.id === id);
    if (i !== -1) { arr[i] = {...arr[i], ...patch}; this.save(arr); }
  },
  clear() { localStorage.removeItem(this.KEY); },
};

/* ==================== RATE LIMIT ==================== */
const Rate = {
  KEY: 'policeAlert_rate',
  LIMIT: 10, WIN: 3600000,
  can() {
    try {
      const r = JSON.parse(localStorage.getItem(this.KEY) || '{"c":0,"t":0}');
      if (Date.now() - r.t >= this.WIN) return { ok: true };
      return { ok: this.LIMIT - r.c > 0 };
    } catch { return { ok: true }; }
  },
  bump() {
    try {
      const r = JSON.parse(localStorage.getItem(this.KEY) || '{"c":0,"t":0}');
      if (Date.now() - r.t >= this.WIN) localStorage.setItem(this.KEY, JSON.stringify({c:1,t:Date.now()}));
      else localStorage.setItem(this.KEY, JSON.stringify({c:r.c+1,t:r.t}));
    } catch {}
  },
};

const Voted = {
  KEY: 'policeAlert_voted',
  has(id) {
    try { return !!JSON.parse(localStorage.getItem(this.KEY)||'{}')[id]; } catch { return false; }
  },
  set(id) {
    try {
      const v = JSON.parse(localStorage.getItem(this.KEY)||'{}');
      v[id] = Date.now();
      localStorage.setItem(this.KEY, JSON.stringify(v));
    } catch {}
  },
};

/* ==================== MAP ==================== */
function initMap() {
  S.map = L.map('map', {
    center: [CONFIG.DEFAULT_LAT, CONFIG.DEFAULT_LNG],
    zoom: CONFIG.DEFAULT_ZOOM,
    zoomControl: false,
    preferCanvas: true,  // faster rendering
  });

  // Try fast CARTO tiles first
  const tile = CONFIG.TILES[0];
  S.tileLayer = L.tileLayer(tile.url, {
    attribution: tile.attr,
    maxZoom: tile.maxZoom,
    crossOrigin: true,
  });

  // If CARTO fails, fallback to OSM
  S.tileLayer.on('tileerror', () => {
    if (!S._fallback) {
      S._fallback = true;
      const fb = CONFIG.TILES[1];
      S.tileLayer.setUrl(fb.url);
    }
  });

  S.tileLayer.addTo(S.map);
  S.map.on('click', onMapClick);
}

/* ==================== MARKER ICONS ==================== */
function makeIcon(type, faded = false) {
  const t = TYPES[type] || TYPES.Police;
  const op = faded ? '0.3' : '1';
  return L.divIcon({
    html: `<div class="marker-pin" style="opacity:${op}">
      <div class="marker-body" style="background:${t.color}">${t.emoji}</div>
      <div class="marker-shadow"></div>
    </div>`,
    className: '',
    iconSize: [38, 50],
    iconAnchor: [19, 50],
    popupAnchor: [0, -52],
  });
}

/* ==================== POPUPS ==================== */
function popupHTML(m) {
  const t = TYPES[m.type] || TYPES.Police;
  const voted = Voted.has(m.id);
  const faded = (m.wrong || 0) >= CONFIG.WRONG_THRESHOLD;
  return `
    <div class="popup-card">
      <div class="popup-top">
        <div class="popup-badge" style="background:${t.bg};color:${t.color}">${t.emoji} ${t.label}</div>
        <div class="popup-title">${esc(m.name) || t.label + ' সতর্কতা'}</div>
        ${m.desc ? `<div class="popup-desc">${esc(m.desc)}</div>` : ''}
        <div class="popup-time">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${timeAgo(m.created_at)}
          ${faded ? ' · <span style="color:#E63946;font-size:11px;font-weight:700">⚠ অধিক ভুল</span>' : ''}
        </div>
      </div>
      <div class="popup-votes">
        <div class="vote-row">
          <button class="vote-btn confirm-btn" onclick="App.vote('${m.id}','confirm')" ${voted?'disabled':''}>👍 নিশ্চিত <b>${m.confirm||0}</b></button>
          <button class="vote-btn wrong-btn" onclick="App.vote('${m.id}','wrong')" ${voted?'disabled':''}>👎 ভুল <b>${m.wrong||0}</b></button>
        </div>
        ${voted ? '<p style="font-size:11px;color:#888;text-align:center;margin-top:5px">ইতোমধ্যে ভোট দিয়েছেন</p>' : ''}
      </div>
      <div class="popup-footer">
        <button class="popup-remove-btn" onclick="App.removeMarker('${m.id}')">মার্কার সরিয়ে দিন</button>
      </div>
    </div>`;
}

/* ==================== MARKERS ON MAP ==================== */
function putMarker(data) {
  if (S.markers[data.id]) {
    // Update existing
    const entry = S.markers[data.id];
    entry.data = data;
    const faded = (data.wrong||0) >= CONFIG.WRONG_THRESHOLD;
    entry.lm.setIcon(makeIcon(data.type, faded));
    if (entry.lm.isPopupOpen()) entry.lm.setPopupContent(popupHTML(data));
    return;
  }

  const faded = (data.wrong||0) >= CONFIG.WRONG_THRESHOLD;
  const lm = L.marker([data.lat, data.lng], { icon: makeIcon(data.type, faded) })
    .addTo(S.map)
    .bindPopup('', { maxWidth: 300, minWidth: 220 });

  lm.on('click', () => {
    lm.setPopupContent(popupHTML(data));
    lm.openPopup();
  });

  applyFilterToMarker(data.type, lm);
  S.markers[data.id] = { data, lm };
  updateStats();
}

function dropMarker(id) {
  const e = S.markers[id];
  if (!e) return;
  S.map.removeLayer(e.lm);
  delete S.markers[id];
  updateStats();
}

function applyFilterToMarker(type, lm) {
  if (S.activeFilter === 'all' || type === S.activeFilter) lm.setOpacity(1);
  else lm.setOpacity(0);
}

/* ==================== STATS ==================== */
function updateStats() {
  const all = Object.values(S.markers).map(e => e.data);
  const c = { Police:0, Checkpost:0, DB:0, Traffic:0 };
  all.forEach(m => { if (c[m.type] !== undefined) c[m.type]++; });
  document.getElementById('totalCount').textContent    = toBn(all.length);
  document.getElementById('policeCount').textContent   = toBn(c.Police);
  document.getElementById('checkCount').textContent    = toBn(c.Checkpost);
  document.getElementById('dbCount').textContent       = toBn(c.DB);
  document.getElementById('trafficCount').textContent  = toBn(c.Traffic);
}

/* ==================== FILTER ==================== */
function applyFilter(type) {
  S.activeFilter = type;
  Object.values(S.markers).forEach(({ data, lm }) => applyFilterToMarker(data.type, lm));
  document.querySelectorAll('.filter-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.type === type));
}

/* ==================== FIREBASE REALTIME LISTENERS ==================== */
function attachFirebaseListeners() {
  // child_added fires for existing + new ones
  FirebaseDB.onMarkerAdded(m => {
    putMarker(m);
    updateListPanel();
    updateAdminPanel();
  });

  FirebaseDB.onMarkerChanged(m => {
    putMarker(m);
    updateListPanel();
    updateAdminPanel();
  });

  FirebaseDB.onMarkerRemoved(id => {
    dropMarker(id);
    updateListPanel();
    updateAdminPanel();
  });

  setLiveBadge(true);

  // Firebase connection state
  firebase.database().ref('.info/connected').on('value', snap => {
    setLiveBadge(snap.val() === true);
  });
}

/* ==================== ADD LOCATION ==================== */
function enterAddMode() {
  S.isAdding = true;
  S.map.getContainer().classList.add('adding-mode');
  document.getElementById('addingOverlay').classList.remove('hidden');
  const btn = document.getElementById('addLocationBtn');
  btn.innerHTML = '<span style="font-size:18px">✕</span> বাতিল করুন';
  btn.classList.add('active');
}

function exitAddMode() {
  S.isAdding = false;
  S.pendingLatLng = null;
  S.map.getContainer().classList.remove('adding-mode');
  document.getElementById('addingOverlay').classList.add('hidden');
  const btn = document.getElementById('addLocationBtn');
  btn.innerHTML = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> লোকেশন যোগ করুন`;
  btn.classList.remove('active');
}

function onMapClick(e) {
  if (!S.isAdding) return;
  S.pendingLatLng = e.latlng;
  document.getElementById('coordsText').textContent =
    'অক্ষাংশ: ' + e.latlng.lat.toFixed(5) + ' · দ্রাঘিমাংশ: ' + e.latlng.lng.toFixed(5);
  document.getElementById('locName').value = '';
  document.getElementById('locDesc').value = '';
  document.getElementById('locName').placeholder = 'যেমন: মিরপুর ১০ গোল চত্বর';
  document.getElementById('addModal').classList.remove('hidden');

  // Async reverse geocode to fill placeholder
  reverseGeocode(e.latlng.lat, e.latlng.lng).then(name => {
    if (name) document.getElementById('locName').placeholder = name;
  });
}

async function saveLocation() {
  if (!S.pendingLatLng) return;
  if (!Rate.can().ok) {
    toast('প্রতি ঘণ্টায় সর্বোচ্চ ১০টি রিপোর্ট করা যাবে', 'error');
    return;
  }

  const btn = document.getElementById('saveLocationBtn');
  btn.disabled = true;
  btn.textContent = 'সংরক্ষণ হচ্ছে...';

  const name = document.getElementById('locName').value.trim() ||
               document.getElementById('locName').placeholder || '';
  const m = {
    id: genId(),
    lat: S.pendingLatLng.lat,
    lng: S.pendingLatLng.lng,
    type: S.selectedType,
    name: name,
    desc: document.getElementById('locDesc').value.trim(),
    confirm: 0,
    wrong: 0,
    created_at: Date.now(),
  };

  try {
    if (S.useFirebase) {
      await FirebaseDB.addMarker(m);
      // Firebase listener will auto-add to map
    } else {
      Local.add(m);
      putMarker(m);
      updateListPanel();
      updateAdminPanel();
    }
    Rate.bump();
    document.getElementById('addModal').classList.add('hidden');
    exitAddMode();
    toast('লোকেশন সফলভাবে যোগ হয়েছে! 🎉', 'success');
    S.map.panTo([m.lat, m.lng]);
  } catch (err) {
    toast('সংরক্ষণ ব্যর্থ হয়েছে: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> সংরক্ষণ করুন`;
  }
}

/* ==================== VOTING ==================== */
window.App = {
  async vote(id, type) {
    if (Voted.has(id)) { toast('ইতোমধ্যে ভোট দিয়েছেন'); return; }

    const entry = S.markers[id];
    if (!entry) return;

    const patch = { [type]: (entry.data[type] || 0) + 1 };
    const updated = { ...entry.data, ...patch };

    if (S.useFirebase) {
      await FirebaseDB.updateMarker(id, patch);
    } else {
      Local.update(id, patch);
      putMarker(updated);
    }

    Voted.set(id);
    toast(type === 'confirm' ? '👍 নিশ্চিত করা হয়েছে!' : '👎 ভুল রিপোর্ট দেওয়া হয়েছে');
  },

  async removeMarker(id) {
    showConfirm('মার্কার মুছুন', 'এই লোকেশনটি মুছে ফেলবেন?', async () => {
      if (S.useFirebase) {
        await FirebaseDB.removeMarker(id);
      } else {
        Local.remove(id);
        dropMarker(id);
        updateListPanel();
        updateAdminPanel();
      }
      S.map.closePopup();
      toast('মার্কার মুছে ফেলা হয়েছে');
    });
  },

  gotoMarker(id) {
    const e = S.markers[id];
    if (!e) return;
    closeAllPanels();
    S.map.setView([e.data.lat, e.data.lng], 17);
    setTimeout(() => { e.lm.setPopupContent(popupHTML(e.data)); e.lm.openPopup(); }, 300);
  },
};

/* ==================== LIST PANEL ==================== */
function updateListPanel() {
  const body = document.getElementById('listPanelBody');
  const q = (document.getElementById('listSearchInput')?.value || '').toLowerCase().trim();
  const all = Object.values(S.markers).map(e => e.data)
    .sort((a,b) => b.created_at - a.created_at);

  const filtered = q ? all.filter(m =>
    (m.name||'').toLowerCase().includes(q) ||
    (m.desc||'').toLowerCase().includes(q) ||
    (TYPES[m.type]?.label||'').includes(q)
  ) : all;

  if (!filtered.length) {
    body.innerHTML = `<div class="empty-state"><div class="empty-icon">📍</div><p>কোনো রিপোর্ট নেই</p></div>`;
    return;
  }
  body.innerHTML = filtered.map(m => {
    const t = TYPES[m.type] || TYPES.Police;
    return `<div class="list-item">
      <div class="list-item-header" onclick="App.gotoMarker('${m.id}')">
        <span class="list-type-badge" style="background:${t.bg};color:${t.color}">${t.emoji} ${t.label}</span>
        <div class="list-item-info">
          <div class="list-item-name">${esc(m.name) || t.label + ' সতর্কতা'}</div>
          <div class="list-item-time">${timeAgo(m.created_at)}</div>
        </div>
        <div class="list-item-votes"><span>👍${m.confirm||0}</span><span>👎${m.wrong||0}</span></div>
        <button class="go-btn">→</button>
      </div>
    </div>`;
  }).join('');
}

/* ==================== ADMIN PANEL ==================== */
function updateAdminPanel() {
  const all = Object.values(S.markers).map(e => e.data);
  const hidden = all.filter(m => (m.wrong||0) >= CONFIG.WRONG_THRESHOLD).length;
  document.getElementById('adminTotal').textContent  = toBn(all.length);
  document.getElementById('adminHidden').textContent = toBn(hidden);

  const list = document.getElementById('adminMarkerList');
  if (!all.length) { list.innerHTML = '<p style="font-size:13px;color:#999;text-align:center;padding:16px">কোনো মার্কার নেই</p>'; return; }

  list.innerHTML = all.sort((a,b) => b.created_at - a.created_at).map(m => {
    const t = TYPES[m.type] || TYPES.Police;
    return `<div class="admin-marker-row">
      <div class="type-dot" style="background:${t.color}"></div>
      <span class="admin-marker-name">${esc(m.name||t.label)} · ${timeAgo(m.created_at)}</span>
      <span style="font-size:10px;color:#999">👍${m.confirm||0} 👎${m.wrong||0}</span>
      <button class="admin-marker-del" onclick="adminDel('${m.id}')">মুছুন</button>
    </div>`;
  }).join('');
}

window.adminDel = async (id) => {
  if (S.useFirebase) await FirebaseDB.removeMarker(id);
  else { Local.remove(id); dropMarker(id); updateListPanel(); updateAdminPanel(); }
  toast('মার্কার মুছে ফেলা হয়েছে');
};

/* ==================== GEOCODING ==================== */
let _geoTimer;
async function geocode(q) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=bd&limit=5&accept-language=bn`);
    return await r.json();
  } catch { return []; }
}
async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=bn`);
    const d = await r.json();
    return (d.display_name || '').split(',').slice(0,2).join(',').trim();
  } catch { return ''; }
}

/* ==================== GPS ==================== */
function locateUser() {
  if (!navigator.geolocation) { toast('লোকেশন সমর্থিত নয়', 'error'); return; }
  toast('লোকেশন খোঁজা হচ্ছে...');
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    S.map.setView([lat, lng], 16);
    if (S.userMarker) S.map.removeLayer(S.userMarker);
    S.userMarker = L.marker([lat, lng], {
      icon: L.divIcon({ html: '<div class="user-dot"></div>', className: '', iconSize: [16,16], iconAnchor: [8,8] }),
      zIndexOffset: 1000,
    }).addTo(S.map).bindPopup('আপনার অবস্থান').openPopup();
    toast('আপনার অবস্থানে চলে এসেছি ✓', 'success');
  }, err => {
    const m = {1:'পারমিশন দেওয়া হয়নি',2:'লোকেশন পাওয়া যায়নি',3:'টাইমআউট'};
    toast(m[err.code] || 'লোকেশন পাওয়া যায়নি', 'error');
  }, { timeout: 10000, enableHighAccuracy: true });
}

/* ==================== CONFIRM DIALOG ==================== */
let _confirmCb = null;
function showConfirm(title, msg, cb) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  document.getElementById('confirmDialog').classList.remove('hidden');
  _confirmCb = cb;
}

/* ==================== CLOSE PANELS ==================== */
function closeAllPanels() {
  ['listPanel','adminPanel','searchBar','filterBar'].forEach(id =>
    document.getElementById(id).classList.add('hidden'));
  document.getElementById('searchResults').style.display = 'none';
}

/* ==================== FIREBASE CONFIG WIZARD ==================== */
const CONFIG_KEY = 'policeAlert_fbConfig';

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

async function tryInitFirebase(config) {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }
    const db = firebase.database();
    // Quick connection test
    await db.ref('.info/serverTimeOffset').once('value');
    return true;
  } catch (e) {
    console.error('Firebase init failed:', e);
    return false;
  }
}

function showSetupWizard() {
  document.getElementById('splash').style.display = 'none';
  document.getElementById('setupWizard').style.display = 'flex';
}

function parseConfigInput(text) {
  if (!text || !text.trim()) return null;
  try {
    // Step 1: Extract the {...} block
    const braceStart = text.indexOf('{');
    const braceEnd   = text.lastIndexOf('}');
    if (braceStart === -1 || braceEnd === -1) return null;
    let block = text.slice(braceStart, braceEnd + 1);

    // Step 2: Convert JS object to valid JSON
    // - Add quotes around unquoted keys: apiKey: → "apiKey":
    block = block.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    // - Convert single-quoted strings to double-quoted
    block = block.replace(/'([^'\\]*)'/g, '"$1"');
    // - Remove trailing commas before } or ]
    block = block.replace(/,\s*([}\]])/g, '$1');
    // - Remove JS comments (// ...)
    block = block.replace(/\/\/[^\n]*/g, '');

    return JSON.parse(block);
  } catch (e) {
    // Last resort: use Function constructor to evaluate JS object safely
    try {
      const braceStart = text.indexOf('{');
      const braceEnd   = text.lastIndexOf('}');
      if (braceStart === -1) return null;
      const block = text.slice(braceStart, braceEnd + 1);
      // eslint-disable-next-line no-new-func
      const obj = (new Function('return ' + block))();
      if (obj && typeof obj === 'object') return obj;
    } catch {}
    return null;
  }
}

/* ==================== BOOT ==================== */
async function boot() {
  await new Promise(r => setTimeout(r, 800));

  // Check for saved Firebase config
  const saved = loadSavedConfig();

  if (saved) {
    setSplashStatus('Firebase সংযোগ হচ্ছে...');
    const ok = await tryInitFirebase(saved);
    if (ok) {
      S.useFirebase = true;
      await startApp(true);
      return;
    } else {
      // Config may be stale — show wizard
      localStorage.removeItem(CONFIG_KEY);
    }
  }

  // No config — show wizard
  showSetupWizard();
  bindSetupEvents();
}

async function startApp(withFirebase) {
  setSplashStatus('ম্যাপ লোড হচ্ছে...');
  initMap();

  if (withFirebase) {
    setSplashStatus('লাইভ ডেটা লোড হচ্ছে...');
    attachFirebaseListeners();
    await new Promise(r => setTimeout(r, 800));
  } else {
    // Load from localStorage
    setLiveBadge(false);
    Local.get().forEach(m => putMarker(m));
  }

  bindEvents();
  setSplashStatus('প্রস্তুত!');
  await new Promise(r => setTimeout(r, 400));
  hideSplash();

  // Auto GPS
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => S.map.setView([pos.coords.latitude, pos.coords.longitude], 14),
      () => {}
    );
  }

  // PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function bindSetupEvents() {
  document.getElementById('saveConfigBtn').addEventListener('click', async () => {
    const raw = document.getElementById('configInput').value.trim();
    const cfg = parseConfigInput(raw);
    const errEl = document.getElementById('setupError');

    if (!cfg) {
      errEl.textContent = '❌ Config পড়া যায়নি। {…} সহ পুরো firebaseConfig পেস্ট করুন।';
      errEl.style.display = 'block';
      return;
    }
    if (!cfg.apiKey) {
      errEl.textContent = '❌ apiKey পাওয়া যাচ্ছে না। সম্পূর্ণ config কপি করুন।';
      errEl.style.display = 'block';
      return;
    }
    if (!cfg.databaseURL && cfg.projectId) {
      cfg.databaseURL = 'https://' + cfg.projectId + '-default-rtdb.asia-southeast1.firebasedatabase.app';
    }
    if (!cfg.databaseURL) {
      errEl.textContent = '❌ databaseURL নেই। Firebase Console → Realtime Database থেকে URL নিন।';
      errEl.style.display = 'block';
      return;
    }

    errEl.style.display = 'none';
    document.getElementById('saveConfigBtn').textContent = 'সংযোগ হচ্ছে...';
    document.getElementById('saveConfigBtn').disabled = true;

    const ok = await tryInitFirebase(cfg);
    if (ok) {
      saveConfig(cfg);
      S.useFirebase = true;
      document.getElementById('setupWizard').style.display = 'none';
      document.getElementById('splash').style.display = 'flex';
      await startApp(true);
    } else {
      errEl.textContent = '❌ সংযোগ ব্যর্থ। apiKey ও databaseURL সঠিক কিনা নিশ্চিত করুন। Firebase Realtime Database চালু আছে কিনা দেখুন।';
      errEl.style.display = 'block';
      document.getElementById('saveConfigBtn').textContent = '✓ সংরক্ষণ করুন ও শুরু করুন';
      document.getElementById('saveConfigBtn').disabled = false;
    }
  });

  document.getElementById('skipSetupBtn').addEventListener('click', async () => {
    document.getElementById('setupWizard').style.display = 'none';
    document.getElementById('splash').style.display = 'flex';
    S.useFirebase = false;
    await startApp(false);
  });
}

/* ==================== UI EVENTS ==================== */
function bindEvents() {

  // Add location
  document.getElementById('addLocationBtn').addEventListener('click', () => {
    if (S.isAdding) exitAddMode();
    else { closeAllPanels(); enterAddMode(); toast('ম্যাপে ট্যাপ করুন লোকেশন মার্ক করতে'); }
  });
  document.getElementById('cancelAddBtn').addEventListener('click', exitAddMode);
  document.getElementById('closeAddModal').addEventListener('click', () =>
    document.getElementById('addModal').classList.add('hidden'));
  document.getElementById('cancelAddModal').addEventListener('click', () =>
    document.getElementById('addModal').classList.add('hidden'));
  document.getElementById('saveLocationBtn').addEventListener('click', saveLocation);

  // Type grid
  document.getElementById('typeGrid').addEventListener('click', e => {
    const btn = e.target.closest('.type-btn');
    if (!btn) return;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.selectedType = btn.dataset.type;
  });

  // GPS
  document.getElementById('locateBtn').addEventListener('click', locateUser);

  // Zoom
  document.getElementById('zoomInBtn').addEventListener('click', () => S.map.zoomIn());
  document.getElementById('zoomOutBtn').addEventListener('click', () => S.map.zoomOut());

  // Search
  document.getElementById('searchToggleBtn').addEventListener('click', () => {
    document.getElementById('searchBar').classList.toggle('hidden');
    document.getElementById('searchInput').focus();
  });
  document.getElementById('searchInput').addEventListener('input', e => {
    const q = e.target.value.trim();
    document.getElementById('searchClearBtn').style.display = q ? 'block' : 'none';
    clearTimeout(_geoTimer);
    if (!q) { document.getElementById('searchResults').style.display = 'none'; return; }
    _geoTimer = setTimeout(async () => {
      const res = await geocode(q);
      const box = document.getElementById('searchResults');
      if (!res.length) { box.innerHTML = '<div class="search-result-item">কোনো ফলাফল নেই</div>'; box.style.display='block'; return; }
      box.innerHTML = res.map(r => {
        const name = r.display_name.split(',').slice(0,3).join(', ');
        return `<div class="search-result-item" onclick="goSearch(${r.lat},${r.lon})">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${esc(name)}</div>`;
      }).join('');
      box.style.display = 'block';
    }, 500);
  });
  window.goSearch = (lat, lng) => {
    S.map.setView([parseFloat(lat), parseFloat(lng)], 15);
    document.getElementById('searchResults').style.display = 'none';
    toast('লোকেশনে চলে এসেছি ✓');
  };
  document.getElementById('searchClearBtn').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClearBtn').style.display = 'none';
    document.getElementById('searchResults').style.display = 'none';
  });

  // Filter
  document.getElementById('filterBtn').addEventListener('click', () =>
    document.getElementById('filterBar').classList.toggle('hidden'));
  document.getElementById('filterBar').addEventListener('click', e => {
    const c = e.target.closest('.filter-chip');
    if (c) applyFilter(c.dataset.type);
  });

  // List
  document.getElementById('listViewBtn').addEventListener('click', () => {
    updateListPanel();
    document.getElementById('listPanel').classList.toggle('hidden');
    document.getElementById('adminPanel').classList.add('hidden');
  });
  document.getElementById('closeListPanel').addEventListener('click', () =>
    document.getElementById('listPanel').classList.add('hidden'));
  document.getElementById('listSearchInput').addEventListener('input', updateListPanel);

  // Admin
  document.getElementById('adminToggleBtn').addEventListener('click', () => {
    updateAdminPanel();
    document.getElementById('adminPanel').classList.toggle('hidden');
    document.getElementById('listPanel').classList.add('hidden');
  });
  document.getElementById('closeAdminPanel').addEventListener('click', () =>
    document.getElementById('adminPanel').classList.add('hidden'));

  document.getElementById('clearAllBtn').addEventListener('click', () => {
    showConfirm('সব রিপোর্ট মুছুন', 'সব মার্কার স্থায়ীভাবে মুছে ফেলবেন?', async () => {
      if (S.useFirebase) await FirebaseDB.clearAll();
      else {
        Local.clear();
        Object.values(S.markers).forEach(e => S.map.removeLayer(e.lm));
        S.markers = {};
        updateStats(); updateListPanel(); updateAdminPanel();
      }
      toast('সব মার্কার মুছে ফেলা হয়েছে', 'error');
    });
  });

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const data = Object.values(S.markers).map(e => e.data);
    const blob = new Blob([JSON.stringify({ markers: data, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'police-alert-backup-' + new Date().toISOString().slice(0,10) + '.json'; a.click();
    toast('ব্যাকআপ ডাউনলোড হচ্ছে', 'success');
  });

  document.getElementById('importBtn').addEventListener('click', () =>
    document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const arr = data.markers || [];
      for (const m of arr) {
        if (S.useFirebase) await FirebaseDB.addMarker(m);
        else { Local.add(m); putMarker(m); }
      }
      updateListPanel(); updateAdminPanel();
      toast(toBn(arr.length) + 'টি রিপোর্ট ইমপোর্ট হয়েছে!', 'success');
    } catch { toast('ইমপোর্ট ব্যর্থ — ফাইল চেক করুন', 'error'); }
    e.target.value = '';
  });

  document.getElementById('reconfigBtn').addEventListener('click', () => {
    localStorage.removeItem(CONFIG_KEY);
    location.reload();
  });

  // Confirm dialog
  document.getElementById('confirmYes').addEventListener('click', () => {
    document.getElementById('confirmDialog').classList.add('hidden');
    if (_confirmCb) { _confirmCb(); _confirmCb = null; }
  });
  document.getElementById('confirmNo').addEventListener('click', () => {
    document.getElementById('confirmDialog').classList.add('hidden');
    _confirmCb = null;
  });

  // Backdrop close
  document.getElementById('addModal').addEventListener('click', e => {
    if (e.target === document.getElementById('addModal'))
      document.getElementById('addModal').classList.add('hidden');
  });

  // Keyboard ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { exitAddMode(); closeAllPanels(); }
  });
}

/* ==================== START ==================== */
document.addEventListener('DOMContentLoaded', boot);
