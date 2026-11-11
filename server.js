'use strict';
/**
 * Carl's Spelling Bee (CSB) - Air Alert API
 * FICTIONAL SIMULATION. Zero dependencies. Run: node server.js
 *
 * Env:
 *   PORT                        port (default 3000)
 *   ADMIN_KEY                   secret key for the hidden admin API (strongly recommended)
 *   UPSTASH_REDIS_REST_URL/TOKEN  optional: persistent shared storage (survives Render restarts)
 *   STATE_FILE                  optional: file used when no Redis is configured
 *   TIME_SCALE                  initial flight-speed multiplier (default 4)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = +process.env.PORT || 3000;
const DEMO_KEY = 'csb-demo-key';
const RATE_LIMIT = 120; // requests / minute / key / IP
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
const R_URL = process.env.UPSTASH_REDIS_REST_URL, R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/* ------------------------------ geo helpers ------------------------------ */
const R = 6371;
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
function dist(a, b) {
  const dLa = rad(b.lat - a.lat), dLo = rad(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return Math.round((deg(Math.atan2(y, x)) + 360) % 360);
}
const lerp = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
const r4 = n => Math.round(n * 10000) / 10000;
const pick = a => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi, def) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
const clone = o => JSON.parse(JSON.stringify(o));
function jitter(p, km) {
  if (!km) return { lat: p.lat, lng: p.lng };
  return { lat: p.lat + rnd(-km, km) / 111, lng: p.lng + rnd(-km, km) / (111 * Math.max(.2, Math.cos(rad(p.lat)))) };
}

/* ----------------------------- map geometry ------------------------------ */
// Real administrative borders (Natural Earth, simplified), see geo.json
const GEO = JSON.parse(fs.readFileSync(path.join(__dirname, 'geo.json'), 'utf8'));
const polysOf = g => g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
const ZONES = GEO.zones.features.map(f => {
  const polys = polysOf(f.geometry);
  let w = 180, s = 90, e = -180, n = -90;
  for (const poly of polys) for (const [x, y] of poly[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  const p = f.properties;
  return { id: p.id, name: p.name, country: p.country, side: p.side, group: p.group, lat: p.lat, lng: p.lng, small: !!p.small, polys, bbox: [w, s, e, n] };
});
const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]));
const CSB_ZONES = ZONES.filter(z => z.side === 'csb');
const DU_ZONES = ZONES.filter(z => z.side === 'du');
const NEUTRAL = GEO.neutral.features.map(f => polysOf(f.geometry));

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inZone(z, lng, lat) {
  const b = z.bbox;
  if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) return false;
  for (const poly of z.polys) {
    if (!inRing(poly[0], lng, lat)) continue;
    let hole = false;
    for (let i = 1; i < poly.length; i++) if (inRing(poly[i], lng, lat)) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}
function zoneAt(lat, lng, zones = CSB_ZONES) {
  for (const z of zones) if (inZone(z, lng, lat)) return z;
  return null;
}
function nearestZone(lat, lng, zones) {
  let best = null, bd = 1e9;
  for (const z of zones) { const d = dist({ lat, lng }, z); if (d < bd) { bd = d; best = z; } }
  return best;
}
function isLand(lat, lng) {
  if (zoneAt(lat, lng, ZONES)) return true;
  for (const polys of NEUTRAL) for (const poly of polys) if (inRing(poly[0], lng, lat)) return true;
  return false;
}
// zone of the territory that owns the target ('csb' or 'du')
function pointZone(lat, lng, owner) {
  const list = owner === 'csb' ? CSB_ZONES : DU_ZONES;
  return zoneAt(lat, lng, list) || nearestZone(lat, lng, list);
}

/* --------------------------------- data ---------------------------------- */
const WEAPONS = {
  // Dutch Union
  trident_d5: { id: 'trident_d5', owner: 'du', name: 'Trident D5', category: 'ballistic_missile', class: 'SLBM (submarine-launched)', platform: 'sea', speed_kmh: 4200, apex_km: 110, range_km: 7000, auto_range_km: 1300, intercept_chance: 0.45, notes: 'Submarine-launched ballistic missile' },
  hammer_b3: { id: 'hammer_b3', owner: 'du', name: 'Hammer-B3', category: 'ballistic_missile', class: 'Road-mobile ballistic missile (fictional)', platform: 'land', speed_kmh: 3200, apex_km: 60, range_km: 1500, auto_range_km: 1300, intercept_chance: 0.5, notes: 'Road-mobile launcher' },
  storm_shadow: { id: 'storm_shadow', owner: 'du', name: 'Storm Shadow', category: 'cruise_missile', class: 'Air-launched cruise missile', platform: 'air', speed_kmh: 950, apex_km: 0.1, range_km: 560, auto_range_km: 560, intercept_chance: 0.6, notes: 'Low-altitude, terrain hugging' },
  kalibr: { id: 'kalibr', owner: 'du', name: 'Kalibr', category: 'cruise_missile', class: 'Ship-launched cruise missile', platform: 'sea', speed_kmh: 900, apex_km: 0.05, range_km: 1500, auto_range_km: 1300, intercept_chance: 0.6, notes: 'Sea-skimming, launched from surface ships' },
  shahed_136: { id: 'shahed_136', owner: 'du', name: 'Shahed-136', category: 'shahed_drone', class: 'Propeller loitering munition', platform: 'land/sea', speed_kmh: 185, apex_km: 0.25, range_km: 2500, auto_range_km: 800, intercept_chance: 0.8, notes: 'Slow, often launched in salvos' },
  shahed_238: { id: 'shahed_238', owner: 'du', name: 'Shahed-238', category: 'jet_drone', class: 'Jet-powered loitering munition', platform: 'land/sea', speed_kmh: 600, apex_km: 0.5, range_km: 1500, auto_range_km: 1300, intercept_chance: 0.65, notes: 'Jet-powered, much faster than the 136' },
  falcon_j: { id: 'falcon_j', owner: 'du', name: 'Falcon-J', category: 'jet_drone', class: 'Jet attack drone (fictional)', platform: 'land', speed_kmh: 800, apex_km: 0.6, range_km: 1200, auto_range_km: 1200, intercept_chance: 0.6, notes: 'Fictional Dutch Union jet drone' },
  // Carl's Spelling Bee
  m51: { id: 'm51', owner: 'csb', name: 'M51', category: 'ballistic_missile', class: 'SLBM (submarine-launched)', platform: 'sea', speed_kmh: 4800, apex_km: 150, range_km: 9000, auto_range_km: 1300, intercept_chance: 0.4, notes: 'CSB submarine-launched ballistic missile' },
  hades: { id: 'hades', owner: 'csb', name: 'Hades-X', category: 'ballistic_missile', class: 'Road-mobile ballistic missile (fictional)', platform: 'land', speed_kmh: 3000, apex_km: 55, range_km: 700, auto_range_km: 700, intercept_chance: 0.45, notes: 'CSB short-range ballistic missile' },
  scalp: { id: 'scalp', owner: 'csb', name: 'SCALP-EG', category: 'cruise_missile', class: 'Air / ground-launched cruise missile', platform: 'land/air', speed_kmh: 950, apex_km: 0.1, range_km: 560, auto_range_km: 560, intercept_chance: 0.55, notes: 'Low-altitude cruise missile' },
  bee_drone: { id: 'bee_drone', owner: 'csb', name: 'Stinger Bee', category: 'shahed_drone', class: 'Loitering munition (fictional)', platform: 'land', speed_kmh: 220, apex_km: 0.3, range_km: 900, auto_range_km: 600, intercept_chance: 0.7, notes: 'CSB propeller attack drone' }
};
const CLASS = { ballistic_missile: 'ballistic', cruise_missile: 'cruise', jet_drone: 'jet_drone', shahed_drone: 'shahed' };
const PRIORITY = ['ballistic_missile', 'cruise_missile', 'jet_drone', 'shahed_drone'];
const ATTACKER = { du: 'Dutch Union', csb: "Carl's Spelling Bee" };

const mkSite = (id, name, side, kind, lat, lng, weapons, confidence, revealed) => ({ id, name, side, kind, lat, lng, weapons, confidence, revealed: !!revealed, discovered: false, auto: true });
const DEFAULT_SITES = [
  mkSite('LON-1', 'London - Central battery', 'du', 'land', 51.51, -0.13, ['hammer_b3'], 'confirmed', true),
  mkSite('LON-2', 'London - South-west battery', 'du', 'land', 51.46, -0.31, ['hammer_b3'], 'confirmed', true),
  mkSite('LON-3', 'London - East battery', 'du', 'land', 51.58, 0.07, ['hammer_b3'], 'confirmed', true),
  mkSite('LON-4', 'London - South battery', 'du', 'land', 51.40, -0.05, ['hammer_b3'], 'confirmed', true),
  mkSite('DU-RTM', 'Rotterdam area', 'du', 'land', 51.92, 4.48, ['shahed_136', 'shahed_238', 'falcon_j'], 'assessed'),
  mkSite('DU-ANR', 'Antwerp area', 'du', 'land', 51.22, 4.4, ['shahed_136', 'shahed_238', 'falcon_j'], 'assessed'),
  mkSite('DU-BRU', 'Brussels area', 'du', 'land', 50.85, 4.35, ['shahed_136', 'shahed_238', 'falcon_j'], 'assessed'),
  mkSite('DU-LUX', 'Luxembourg', 'du', 'land', 49.61, 6.13, ['shahed_136', 'shahed_238'], 'assessed'),
  mkSite('DU-CGN', 'Cologne area', 'du', 'land', 50.94, 6.96, ['shahed_136', 'shahed_238', 'falcon_j'], 'assessed'),
  mkSite('DU-DUS', 'Düsseldorf area', 'du', 'land', 51.23, 6.78, ['shahed_136', 'falcon_j'], 'assessed'),
  mkSite('SEA-NORTH', 'North Sea', 'du', 'sea', 53.8, 3.0, ['trident_d5', 'shahed_136', 'kalibr'], 'assessed'),
  mkSite('SEA-CHAN', 'English Channel', 'du', 'sea', 50.3, -0.5, ['trident_d5', 'shahed_136', 'shahed_238', 'kalibr'], 'assessed'),
  mkSite('SEA-WEST', 'Atlantic, west of Brittany', 'du', 'sea', 47.2, -8.0, ['trident_d5', 'shahed_136', 'shahed_238', 'kalibr'], 'assessed'),
  mkSite('SEA-BISC', 'Bay of Biscay', 'du', 'sea', 44.5, -5.5, ['trident_d5', 'kalibr'], 'assessed'),
  mkSite('AIR-NS', 'Air-launch box, North Sea', 'du', 'air', 52.4, 2.6, ['storm_shadow'], 'assessed'),
  mkSite('AIR-CH', 'Air-launch box, Channel', 'du', 'air', 50.4, -1.2, ['storm_shadow'], 'assessed'),
  // Carl's Spelling Bee launchers (visible)
  mkSite('CSB-CAL', 'Calais coast battery', 'csb', 'land', 50.88, 1.85, ['hades', 'scalp', 'bee_drone'], 'confirmed', true),
  mkSite('CSB-CHB', 'Cherbourg battery', 'csb', 'land', 49.62, -1.65, ['hades', 'scalp'], 'confirmed', true),
  mkSite('CSB-LIL', 'Lille battery', 'csb', 'land', 50.55, 3.1, ['hades', 'scalp', 'bee_drone'], 'confirmed', true),
  mkSite('CSB-MET', 'Metz battery', 'csb', 'land', 49.1, 6.1, ['hades', 'scalp', 'bee_drone'], 'confirmed', true),
  mkSite('CSB-BRE', 'Atlantic submarine (off Brest)', 'csb', 'sea', 48.2, -6.4, ['m51'], 'confirmed', true),
  mkSite('CSB-MED', 'Mediterranean submarine', 'csb', 'sea', 42.5, 5.5, ['m51'], 'confirmed', true),
  mkSite('CSB-AIR', 'Air-launch box, Normandy coast', 'csb', 'air', 49.8, -0.4, ['scalp'], 'confirmed', true)
];
const tg = (id, name, owner, lat, lng, weight = 1) => ({ id, name, owner, lat, lng, weight });
const DEFAULT_TARGETS = [
  // targets inside CSB (attacked by the Dutch Union)
  tg('p-paris', 'Paris', 'csb', 48.8566, 2.3522, 3), tg('p-lille', 'Lille', 'csb', 50.6292, 3.0573, 3), tg('p-amiens', 'Amiens', 'csb', 49.8941, 2.2958),
  tg('p-rouen', 'Rouen', 'csb', 49.4432, 1.0993), tg('p-lehavre', 'Le Havre', 'csb', 49.4944, 0.1079), tg('p-cherbourg', 'Cherbourg', 'csb', 49.6337, -1.6221),
  tg('p-brest', 'Brest', 'csb', 48.3904, -4.4861, 2), tg('p-rennes', 'Rennes', 'csb', 48.1173, -1.6778), tg('p-nantes', 'Nantes', 'csb', 47.2184, -1.5536),
  tg('p-tours', 'Tours', 'csb', 47.3941, 0.6848), tg('p-metz', 'Metz', 'csb', 49.1193, 6.1757, 3), tg('p-reims', 'Reims', 'csb', 49.2583, 4.0317, 2),
  tg('p-strasbourg', 'Strasbourg', 'csb', 48.5734, 7.7521, 2), tg('p-nancy', 'Nancy', 'csb', 48.6921, 6.1844), tg('p-dijon', 'Dijon', 'csb', 47.322, 5.0415),
  tg('p-lyon', 'Lyon', 'csb', 45.764, 4.8357, 2), tg('p-grenoble', 'Grenoble', 'csb', 45.1885, 5.7245), tg('p-bordeaux', 'Bordeaux', 'csb', 44.8378, -0.5792),
  tg('p-toulouse', 'Toulouse', 'csb', 43.6047, 1.4442), tg('p-montpellier', 'Montpellier', 'csb', 43.6108, 3.8767), tg('p-perpignan', 'Perpignan', 'csb', 42.6887, 2.8948),
  tg('p-marseille', 'Marseille', 'csb', 43.2965, 5.3698), tg('p-nice', 'Nice', 'csb', 43.7102, 7.262), tg('p-monaco', 'Monaco', 'csb', 43.7384, 7.4246),
  tg('p-andorra', 'Andorra la Vella', 'csb', 42.5063, 1.5218), tg('p-barcelona', 'Barcelona', 'csb', 41.3874, 2.1686, 2), tg('p-girona', 'Girona', 'csb', 41.9794, 2.8214),
  tg('p-lleida', 'Lleida', 'csb', 41.6176, 0.62), tg('p-tarragona', 'Tarragona', 'csb', 41.1189, 1.2445), tg('p-pamplona', 'Pamplona', 'csb', 42.8125, -1.6458),
  tg('p-sansebastian', 'San Sebastián', 'csb', 43.3183, -1.9812),
  // targets inside the Dutch Union (attacked by CSB)
  tg('d-london', 'London', 'du', 51.5072, -0.1276, 4), tg('d-dover', 'Dover', 'du', 51.1279, 1.3134), tg('d-southampton', 'Southampton', 'du', 50.9097, -1.4044),
  tg('d-portsmouth', 'Portsmouth', 'du', 50.8198, -1.088), tg('d-plymouth', 'Plymouth', 'du', 50.3755, -4.1427), tg('d-brighton', 'Brighton', 'du', 50.8225, -0.1372),
  tg('d-rotterdam', 'Rotterdam', 'du', 51.9244, 4.4777, 2), tg('d-amsterdam', 'Amsterdam', 'du', 52.3676, 4.9041, 2), tg('d-hague', 'The Hague', 'du', 52.0705, 4.3007),
  tg('d-utrecht', 'Utrecht', 'du', 52.0907, 5.1214), tg('d-eindhoven', 'Eindhoven', 'du', 51.4416, 5.4697), tg('d-antwerp', 'Antwerp', 'du', 51.2194, 4.4025, 2),
  tg('d-brussels', 'Brussels', 'du', 50.8503, 4.3517, 3), tg('d-ghent', 'Ghent', 'du', 51.0543, 3.7174), tg('d-liege', 'Liège', 'du', 50.6326, 5.5797),
  tg('d-luxembourg', 'Luxembourg', 'du', 49.6116, 6.1319, 2), tg('d-cologne', 'Cologne', 'du', 50.9375, 6.9603, 2), tg('d-dusseldorf', 'Düsseldorf', 'du', 51.2277, 6.7735),
  tg('d-aachen', 'Aachen', 'du', 50.7753, 6.0839)
];

/* ------------------------- shared, persistent state ----------------------- */
let state = null;
const defaultState = () => ({
  rev: 1,
  sites: clone(DEFAULT_SITES),
  targets: clone(DEFAULT_TARGETS),
  frontline: clone(GEO.frontline.features),
  names: { zones: {}, groups: {} },
  config: { du_auto: true, csb_auto: true, intensity: 1, time_scale: +process.env.TIME_SCALE || 4 },
  keys: {},
  admin_key: '',
  counters: { site: 100, target: 100, fl: 100 }
});

async function redis(cmd) {
  const r = await fetch(R_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + R_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function loadState() {
  let raw = null;
  if (R_URL && R_TOKEN) {
    for (let i = 0; ; i++) {
      try { raw = await redis(['GET', 'csb:state']); break; }
      catch (e) {
        console.error('Redis load failed:', e.message);
        if (i >= 4) { console.error('Refusing to start with empty state (would overwrite saved data).'); process.exit(1); }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } else if (fs.existsSync(STATE_FILE)) {
    try { raw = fs.readFileSync(STATE_FILE, 'utf8'); } catch (e) { console.error('State file unreadable:', e.message); }
  }
  const d = defaultState();
  state = d;
  if (raw) {
    try {
      const s = JSON.parse(raw);
      state = { ...d, ...s, config: { ...d.config, ...s.config }, names: { zones: {}, groups: {}, ...s.names }, counters: { ...d.counters, ...s.counters }, keys: s.keys || {} };
    } catch (e) { console.error('State corrupt, starting fresh:', e.message); }
  }
  state.keys[DEMO_KEY] = { name: 'public demo key', created: '2026-01-01T00:00:00.000Z' };
  let generated = false;
  if (!process.env.ADMIN_KEY && !state.admin_key) { state.admin_key = 'admin_' + crypto.randomBytes(18).toString('hex'); generated = true; }
  console.log(R_URL ? 'Storage: Upstash Redis (persistent)' : `Storage: file ${STATE_FILE} (NOT persistent on Render free)`);
  if (process.env.ADMIN_KEY) console.log('Admin key: taken from ADMIN_KEY env var');
  else console.log('Admin key (set ADMIN_KEY env var to choose your own): ' + state.admin_key);
  if (generated) persist();
}
let saveTimer = null;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(doSave, 400); }
async function doSave() {
  const body = JSON.stringify(state);
  try { if (R_URL && R_TOKEN) await redis(['SET', 'csb:state', body]); else fs.writeFileSync(STATE_FILE, body); }
  catch (e) { console.error('Save failed:', e.message); }
}
const touch = () => { state.rev++; persist(); };
const adminKey = () => process.env.ADMIN_KEY || state.admin_key;

const zName = z => state.names.zones[z.id] || z.name;
const gName = g => state.names.groups[g] || g;
const publicSites = () => state.sites.filter(s => s.revealed || s.discovered).map(s => ({ id: s.id, name: s.name, side: s.side, kind: s.kind, lat: s.lat, lng: s.lng, confidence: s.confidence, weapons: s.weapons }));
const publicState = () => ({ rev: state.rev, frontline: { type: 'FeatureCollection', features: state.frontline }, names: state.names, launch_sites: publicSites() });

/* ------------------------------- simulation ------------------------------ */
const threats = [];
let seq = 100;
const regionSince = {};
let alertCache = { at: 0, data: null };
const invalidate = () => { alertCache = { at: 0, data: null }; };
const progressOf = (t, now = Date.now()) => Math.max(0, (now - t.launched_ms) / 1000 / t.flight_s);
const etaOf = (t, now) => Math.max(0, Math.round(t.flight_s * (1 - Math.min(1, progressOf(t, now)))));

function spawnThreat(o) {
  const weapon = WEAPONS[o.weapon];
  if (!weapon) return null;
  const side = o.side === 'csb' ? 'csb' : 'du';
  const owner = side === 'du' ? 'csb' : 'du';
  const base = o.site || o.origin;
  const siteSnap = o.site
    ? { id: o.site.id, name: o.site.name, kind: o.site.kind, confidence: o.site.confidence }
    : { id: 'UNKNOWN', name: 'Unidentified launch point', kind: o.origin.kind || (isLand(o.origin.lat, o.origin.lng) ? 'land' : 'sea'), confidence: 'assessed' };
  const origin = jitter(base, o.origin_spread_km ?? 4);
  const dest = jitter(o.target, o.spread_km ?? 3);
  const z = pointZone(dest.lat, dest.lng, owner);
  const distance_km = dist(origin, dest);
  const flight_s = Math.max(90, distance_km / (weapon.speed_kmh * state.config.time_scale) * 3600);
  const t = {
    id: 'TH-' + String(++seq).padStart(6, '0'),
    side, weapon, site: siteSnap, siteId: o.site ? o.site.id : null, origin, dest,
    targetSrc: { name: o.target.name, lat: o.target.lat, lng: o.target.lng },
    target: { name: o.target.name || zName(z), zone_id: z.id },
    distance_km,
    launched_ms: Date.now() + (o.delay_ms || 0),
    flight_s,
    willIntercept: o.outcome === 'hit' ? false : o.outcome === 'intercept' ? true : Math.random() < weapon.intercept_chance,
    interceptAt: rnd(0.7, 0.95),
    ended_ms: null, end_status: null, end_pos: null
  };
  threats.push(t);
  invalidate();
  return t;
}

function altitudeM(t, p) {
  const apex = t.weapon.apex_km * 1000;
  if (t.weapon.category === 'ballistic_missile') return Math.round(Math.sin(Math.PI * Math.min(1, p)) * apex);
  return Math.round(apex * (0.8 + 0.2 * Math.sin(p * 12)));
}
const posOf = (t, now) => lerp(t.origin, t.dest, Math.min(1, progressOf(t, now)));
function endThreat(t, status, now = Date.now()) {
  if (t.ended_ms) return;
  t.ended_ms = now; t.end_status = status;
  t.end_pos = status === 'impact' ? { lat: t.dest.lat, lng: t.dest.lng } : posOf(t, now);
  invalidate();
}

function step(now = Date.now()) {
  for (const t of threats) {
    if (t.ended_ms || now < t.launched_ms) continue;
    if (t.siteId) {
      const s = state.sites.find(x => x.id === t.siteId);
      if (s && !s.discovered) { s.discovered = true; touch(); }
    }
    const p = progressOf(t, now);
    if (t.willIntercept && p >= t.interceptAt) { t.ended_ms = now; t.end_status = 'intercepted'; t.end_pos = lerp(t.origin, t.dest, t.interceptAt); invalidate(); }
    else if (p >= 1) { t.ended_ms = now; t.end_status = 'impact'; t.end_pos = { lat: t.dest.lat, lng: t.dest.lng }; invalidate(); }
  }
  for (let i = threats.length - 1; i >= 0; i--) {
    if (threats[i].ended_ms && now - threats[i].ended_ms > 15 * 60 * 1000) threats.splice(i, 1);
  }
  const ids = new Set(alertsNow(now).map(a => a.zone_id));
  for (const id of ids) if (!regionSince[id]) regionSince[id] = now;
  for (const id of Object.keys(regionSince)) if (!ids.has(id)) delete regionSince[id];
}
const liveThreats = (now = Date.now(), side) => threats.filter(t => !t.ended_ms && now >= t.launched_ms && (!side || t.side === side));

// zones the threat flies over in roughly the next 5 minutes (zones of the attacked side)
function pathZones(t, now) {
  const sec = Math.floor(now / 1000);
  if (t._zc && t._zc.sec === sec) return t._zc.zones;
  const list = t.side === 'du' ? CSB_ZONES : DU_ZONES;
  const cur = lerp(t.origin, t.dest, Math.min(1, progressOf(t, now)));
  const total = dist(cur, t.dest);
  const lookahead = Math.min(total, Math.max(120, t.weapon.speed_kmh * state.config.time_scale * 300 / 3600));
  const n = Math.min(80, Math.max(2, Math.ceil(lookahead / 10)));
  const out = [], seen = new Set();
  for (let i = 0; i <= n; i++) {
    const q = lerp(cur, t.dest, total > 0 ? (i / n) * (lookahead / total) : 0);
    const z = zoneAt(q.lat, q.lng, list);
    if (z && !seen.has(z.id)) { seen.add(z.id); out.push(z.id); }
  }
  if (lookahead >= total && !seen.has(t.target.zone_id)) out.push(t.target.zone_id);
  t._zc = { sec, zones: out };
  return out;
}

function serialize(t, now = Date.now(), detail = false) {
  const p = t.ended_ms ? (t.end_status === 'intercepted' ? Math.min(1, progressOf(t, t.ended_ms)) : 1) : Math.min(1, progressOf(t, now));
  const pos = t.ended_ms ? t.end_pos : lerp(t.origin, t.dest, p);
  const status = t.ended_ms ? t.end_status : (p < 0.08 ? 'launched' : 'inbound');
  const remaining = t.ended_ms ? 0 : etaOf(t, now);
  const tz = ZONE_BY_ID[t.target.zone_id];
  const o = {
    id: t.id,
    side: t.side,
    attacker: ATTACKER[t.side],
    status,
    type: t.weapon.category,
    alert_class: CLASS[t.weapon.category],
    weapon: { id: t.weapon.id, name: t.weapon.name, class: t.weapon.class, platform: t.weapon.platform },
    launched_at: new Date(t.launched_ms).toISOString(),
    eta_seconds: remaining,
    impact_at: t.ended_ms ? null : new Date(now + remaining * 1000).toISOString(),
    progress: Math.round(p * 1000) / 1000,
    current_position: {
      lat: r4(pos.lat), lng: r4(pos.lng),
      altitude_m: t.ended_ms ? 0 : altitudeM(t, p),
      heading_deg: bearing(t.origin, t.dest),
      speed_kmh: t.ended_ms ? 0 : t.weapon.speed_kmh
    },
    origin: { site_id: t.site.id, name: t.site.name, kind: t.site.kind, lat: r4(t.origin.lat), lng: r4(t.origin.lng), confidence: t.site.confidence },
    target: { name: t.target.name, zone_id: tz.id, zone_name: zName(tz), group: gName(tz.group), lat: r4(t.dest.lat), lng: r4(t.dest.lng) },
    distance_km: Math.round(t.distance_km),
    threatened_zones: (t.ended_ms ? [t.target.zone_id] : pathZones(t, now)).map(id => ({ id, name: zName(ZONE_BY_ID[id]) })),
    ended_at: t.ended_ms ? new Date(t.ended_ms).toISOString() : null
  };
  if (detail) {
    o.trajectory = Array.from({ length: 21 }, (_, i) => {
      const q = i / 20, pt = lerp(t.origin, t.dest, q);
      return { lat: r4(pt.lat), lng: r4(pt.lng), altitude_m: altitudeM(t, q), passed: q <= p };
    });
    o.weapon = { ...WEAPONS[t.weapon.id] };
  }
  return o;
}

// air-raid alerts are only for the Dutch Union's attacks on CSB territory
function alertsNow(now = Date.now()) {
  if (alertCache.data && Math.abs(now - alertCache.at) < 400) return alertCache.data;
  const map = {};
  for (const t of liveThreats(now, 'du')) for (const id of pathZones(t, now)) (map[id] = map[id] || []).push(t);
  const res = Object.entries(map).map(([id, ts]) => {
    const z = ZONE_BY_ID[id];
    const types = [...new Set(ts.map(t => t.weapon.category))];
    const dominant = PRIORITY.find(x => types.includes(x));
    const direct = ts.some(t => t.target.zone_id === id);
    return {
      zone_id: id, name: zName(z), group: gName(z.group), country: z.country, lat: z.lat, lng: z.lng,
      level: direct && (dominant === 'ballistic_missile' || dominant === 'cruise_missile') ? 'critical' : 'alert',
      dominant_threat: CLASS[dominant],
      since: new Date(regionSince[id] || now).toISOString(),
      threat_count: ts.length,
      threat_types: types,
      weapons: [...new Set(ts.map(t => t.weapon.name))],
      threat_ids: ts.map(t => t.id),
      directly_targeted: direct,
      nearest_eta_seconds: Math.min(...ts.map(t => etaOf(t, now)))
    };
  }).sort((a, b) => a.nearest_eta_seconds - b.nearest_eta_seconds);
  alertCache = { at: now, data: res };
  return res;
}

function stats(now = Date.now()) {
  const live = liveThreats(now, 'du'), out = liveThreats(now, 'csb');
  const ended = threats.filter(t => t.ended_ms);
  const byType = {};
  for (const t of live) byType[t.weapon.category] = (byType[t.weapon.category] || 0) + 1;
  const cnt = (side, st) => ended.filter(t => t.side === side && t.end_status === st).length;
  return {
    active_threats: live.length,
    active_by_type: byType,
    active_csb_strikes: out.length,
    zones_under_alert: alertsNow(now).length,
    last_15min: { intercepted: cnt('du', 'intercepted'), impacts: cnt('du', 'impact') },
    csb_last_15min: { intercepted: cnt('csb', 'intercepted'), impacts: cnt('csb', 'impact') },
    time_scale: state.config.time_scale,
    server_time: new Date(now).toISOString()
  };
}

/* ------------------------------- autopilot ------------------------------- */
function pickTarget(owner, site, weapon) {
  const pool = state.targets.filter(t => t.owner === owner && dist(site, t) <= weapon.auto_range_km);
  if (!pool.length) return null;
  const total = pool.reduce((s, t) => s + (t.weight || 1), 0);
  let x = Math.random() * total;
  for (const t of pool) { if ((x -= (t.weight || 1)) <= 0) return t; }
  return pool[0];
}
function launchOne(side, site, weaponId, forced, delay = 0) {
  const ws = site.weapons.filter(w => WEAPONS[w]);
  if (!ws.length) return null;
  const wid = weaponId || pick(ws);
  const w = WEAPONS[wid];
  const owner = side === 'du' ? 'csb' : 'du';
  const tgt = forced || pickTarget(owner, site, w);
  if (!tgt) return null;
  return spawnThreat({ side, weapon: wid, site, target: { name: tgt.name, lat: tgt.lat, lng: tgt.lng }, delay_ms: delay });
}
const isDrone = w => WEAPONS[w] && WEAPONS[w].category.endsWith('drone');
function autoSpawn(side) {
  const sites = state.sites.filter(s => s.side === side && s.auto !== false && s.weapons.some(w => WEAPONS[w]));
  if (!sites.length) return;
  if (liveThreats(Date.now(), side).length >= (side === 'du' ? 14 : 8)) return;
  if (Math.random() < 0.28) {
    const ds = sites.filter(s => s.weapons.some(isDrone));
    if (ds.length) {
      const site = pick(ds);
      const first = launchOne(side, site, pick(site.weapons.filter(isDrone)));
      if (first) {
        const n = 2 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) launchOne(side, site, pick(site.weapons.filter(isDrone)), first.targetSrc, (i + 1) * 1500);
      }
      return;
    }
  }
  launchOne(side, pick(sites));
}
function scheduleAuto(side) {
  const [a, b] = side === 'du' ? [7000, 18000] : [12000, 28000];
  setTimeout(() => {
    try { if (state.config[side + '_auto']) autoSpawn(side); } catch (e) { console.error(e); }
    scheduleAuto(side);
  }, rnd(a, b) / Math.max(.2, state.config.intensity));
}

/* --------------------------------- auth ---------------------------------- */
const buckets = {};
setInterval(() => { const n = Date.now(); for (const k of Object.keys(buckets)) if (buckets[k].reset < n) delete buckets[k]; }, 60000).unref();
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function authenticate(req, url) {
  const h = req.headers;
  let key = h['x-api-key'] || url.searchParams.get('api_key');
  const a = h['authorization'];
  if (!key && a && /^Bearer /i.test(a)) key = a.slice(7).trim();
  if (!key) return { error: [401, 'missing_api_key', 'Provide a key via the x-api-key header, Authorization: Bearer, or ?api_key=. Get one with POST /api/v1/keys'] };
  if (!state.keys[key]) return { error: [401, 'invalid_api_key', 'Unknown API key'] };
  const now = Date.now(), bk = key + '|' + clientIp(req);
  const b = buckets[bk] = buckets[bk] && buckets[bk].reset > now ? buckets[bk] : { count: 0, reset: now + 60000 };
  b.count++;
  if (b.count > RATE_LIMIT) return { error: [429, 'rate_limited', `Limit is ${RATE_LIMIT} requests/minute`], headers: { 'Retry-After': Math.ceil((b.reset - now) / 1000) } };
  return { key, headers: { 'X-RateLimit-Limit': RATE_LIMIT, 'X-RateLimit-Remaining': RATE_LIMIT - b.count } };
}
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
function isAdmin(req) {
  const k = req.headers['x-admin-key'];
  return !!k && crypto.timingSafeEqual(sha(k), sha(adminKey()));
}

/* --------------------------------- http ---------------------------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'x-api-key, authorization, content-type, x-admin-key',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    ...headers
  });
  res.end(JSON.stringify(body, null, 2));
}
const ok = (res, data, h) => send(res, 200, { ok: true, simulation: true, rev: state.rev, generated_at: new Date().toISOString(), ...data }, h);
const fail = (res, code, err, msg, h) => send(res, code, { ok: false, error: err, message: msg }, h);

const countBy = (arr, k) => arr.reduce((o, x) => (o[x[k]] = (o[x[k]] || 0) + 1, o), {});
const zoneInfo = z => ({ id: z.id, name: zName(z), country: z.country, side: z.side, group: gName(z.group), lat: z.lat, lng: z.lng });

const GEOMETRY_JSON = JSON.stringify({ ok: true, simulation: true, zones: GEO.zones, groups: GEO.groups, sides: GEO.sides, neutral: GEO.neutral, neutral_labels: GEO.neutral_labels });
const GEOMETRY_GZ = zlib.gzipSync(GEOMETRY_JSON);

function threatList(side, q, now) {
  const include = q.get('include');
  let list = threats.filter(t => t.side === side && now >= t.launched_ms);
  if (include !== 'ended' && include !== 'all') list = list.filter(t => !t.ended_ms);
  if (include === 'ended') list = list.filter(t => t.ended_ms);
  let out = list.map(t => serialize(t, now));
  if (q.get('type')) out = out.filter(t => t.type === q.get('type') || t.alert_class === q.get('type'));
  if (q.get('weapon')) out = out.filter(t => t.weapon.id === q.get('weapon'));
  if (q.get('status')) out = out.filter(t => t.status === q.get('status'));
  if (q.get('zone')) out = out.filter(t => t.threatened_zones.some(z => z.id === q.get('zone')));
  if (q.get('group')) out = out.filter(t => t.threatened_zones.some(z => { const g = ZONE_BY_ID[z.id].group; return g === q.get('group') || gName(g) === q.get('group'); }));
  if (q.get('origin_kind')) out = out.filter(t => t.origin.kind === q.get('origin_kind'));
  return out.sort((a, b) => a.eta_seconds - b.eta_seconds);
}

function route(req, res, url, auth) {
  const p = url.pathname.replace(/\/+$/, '');
  const q = url.searchParams;
  const H = auth.headers;
  const now = Date.now();
  let m;

  if (p === '/api/v1/snapshot') {
    return ok(res, { alerts: alertsNow(now), threats: threatList('du', new URLSearchParams('include=all'), now), strikes: threatList('csb', new URLSearchParams('include=all'), now), stats: stats(now) }, H);
  }
  if (p === '/api/v1/state') return ok(res, publicState(), H);
  if (p === '/api/v1/alerts') {
    const a = alertsNow(now);
    return ok(res, { active_count: a.length, by_class: countBy(a, 'dominant_threat'), clear_zones: CSB_ZONES.filter(z => !a.some(x => x.zone_id === z.id)).map(z => z.id), alerts: a }, H);
  }
  if ((m = p.match(/^\/api\/v1\/alerts\/([\w~-]+)$/))) {
    const z = ZONE_BY_ID[m[1]];
    if (!z) return fail(res, 404, 'not_found', 'Unknown zone id. See GET /api/v1/zones', H);
    const a = alertsNow(now).find(x => x.zone_id === z.id);
    if (!a) return ok(res, { zone_id: z.id, name: zName(z), level: 'clear', threats: [] }, H);
    return ok(res, { ...a, threats: a.threat_ids.map(id => serialize(threats.find(t => t.id === id), now)) }, H);
  }
  if (p === '/api/v1/threats' || p === '/api/v1/strikes') {
    const out = threatList(p.endsWith('strikes') ? 'csb' : 'du', q, now);
    return ok(res, { count: out.length, [p.endsWith('strikes') ? 'strikes' : 'threats']: out }, H);
  }
  if ((m = p.match(/^\/api\/v1\/(?:threats|strikes)\/(TH-\d+)$/))) {
    const t = threats.find(x => x.id === m[1] && now >= x.launched_ms);
    if (!t) return fail(res, 404, 'not_found', 'Not found (it may have expired)', H);
    return ok(res, { threat: serialize(t, now, true) }, H);
  }
  if (p === '/api/v1/history') {
    let out = threats.filter(t => t.ended_ms).sort((a, b) => b.ended_ms - a.ended_ms);
    if (q.get('side')) out = out.filter(t => t.side === q.get('side'));
    return ok(res, { count: out.length, threats: out.map(t => serialize(t, now)) }, H);
  }
  if (p === '/api/v1/zones' || p === '/api/v1/regions') {
    const side = q.get('side') || 'csb';
    const list = ZONES.filter(z => side === 'all' || z.side === side).map(zoneInfo);
    return ok(res, { count: list.length, note: 'Alert zones = departments / provinces. Use ?side=du|all for Dutch Union areas.', zones: list }, H);
  }
  if (p === '/api/v1/weapons') {
    const list = Object.values(WEAPONS).filter(w => !q.get('owner') || w.owner === q.get('owner'));
    return ok(res, { count: list.length, weapons: list }, H);
  }
  if (p === '/api/v1/launch-sites') {
    let list = publicSites();
    if (q.get('side')) list = list.filter(s => s.side === q.get('side'));
    return ok(res, { count: list.length, note: 'Dutch Union sites appear once confirmed or after they have launched. CSB sites are always listed.', launch_sites: list }, H);
  }
  if (p === '/api/v1/frontline') return ok(res, { geojson: { type: 'FeatureCollection', features: state.frontline } }, H);
  if (p === '/api/v1/territories') return ok(res, { geojson: GEO.sides }, H);
  if (p === '/api/v1/geometry') {
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600', ...(gz ? { 'Content-Encoding': 'gzip' } : {}), ...H });
    return res.end(gz ? GEOMETRY_GZ : GEOMETRY_JSON);
  }
  if (p === '/api/v1/stats') return ok(res, { stats: stats(now) }, H);
  if (p === '/api/v1/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const push = () => {
      const n = Date.now();
      res.write(`event: snapshot\ndata: ${JSON.stringify({ rev: state.rev, alerts: alertsNow(n), threats: liveThreats(n, 'du').map(t => serialize(t, n)), strikes: liveThreats(n, 'csb').map(t => serialize(t, n)), stats: stats(n) })}\n\n`);
    };
    push();
    const iv = setInterval(push, 2000);
    req.on('close', () => clearInterval(iv));
    return;
  }
  return fail(res, 404, 'not_found', 'Unknown endpoint. See GET /api/v1', H);
}

/* ------------------------------ hidden admin ----------------------------- */
function readBody(req, limit = 300000) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > limit) { reject(new Error('too_large')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}
const str = (v, max, def = '') => (typeof v === 'string' ? v.trim().slice(0, max) : def);
const KINDS = ['land', 'sea', 'air'];
const cleanWeapons = ws => (Array.isArray(ws) ? ws : []).filter(w => WEAPONS[w]);
const adminState = () => ({ ...publicState(), sites: state.sites, targets: state.targets, config: state.config, weapons: Object.values(WEAPONS) });

async function admin(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '').slice('/api/v1/admin'.length);
  const M = req.method;
  const body = (M === 'POST' || M === 'PATCH' || M === 'PUT') ? await readBody(req) : {};
  const now = Date.now();
  let m;
  const done = (extra = {}) => ok(res, { done: true, ...extra });

  if (p === '/ping' && M === 'GET') return ok(res, { admin: true });
  if (p === '/state' && M === 'GET') return ok(res, { state: adminState() });

  // ---- threats
  if (p === '/spawn' && M === 'POST') {
    const side = body.side === 'csb' ? 'csb' : 'du';
    const owner = side === 'du' ? 'csb' : 'du';
    if (!WEAPONS[body.weapon]) return fail(res, 400, 'bad_weapon', 'Unknown weapon');
    let site = null, origin = null;
    if (body.site_id) { site = state.sites.find(s => s.id === body.site_id); if (!site) return fail(res, 400, 'bad_site', 'Unknown launcher'); }
    else if (body.origin && Number.isFinite(+body.origin.lat) && Number.isFinite(+body.origin.lng)) origin = { lat: +body.origin.lat, lng: +body.origin.lng, kind: KINDS.includes(body.origin.kind) ? body.origin.kind : undefined };
    else return fail(res, 400, 'bad_origin', 'Give site_id or origin {lat,lng}');
    let target = null;
    if (body.target_id) { const t = state.targets.find(x => x.id === body.target_id); if (!t) return fail(res, 400, 'bad_target', 'Unknown target'); target = { name: t.name, lat: t.lat, lng: t.lng }; }
    else if (body.target && Number.isFinite(+body.target.lat) && Number.isFinite(+body.target.lng)) target = { name: str(body.target.name, 60), lat: +body.target.lat, lng: +body.target.lng };
    const count = Math.round(clamp(body.count, 1, 80, 1));
    const gap = clamp(body.interval_ms, 0, 60000, count > 1 ? 1200 : 0);
    const spread = clamp(body.spread_km, 0, 150, count > 1 ? 8 : 0);
    const outcome = ['hit', 'intercept'].includes(body.outcome) ? body.outcome : 'auto';
    const ids = [];
    for (let i = 0; i < count; i++) {
      let tgt = target;
      if (!tgt) { // random target in range
        const w = WEAPONS[body.weapon], pool = state.targets.filter(x => x.owner === owner && dist(site || origin, x) <= w.range_km);
        const c = pool.length ? pick(pool) : pick(state.targets.filter(x => x.owner === owner));
        if (!c) return fail(res, 400, 'no_targets', 'No targets available');
        tgt = { name: c.name, lat: c.lat, lng: c.lng };
      }
      const t = spawnThreat({ side, weapon: body.weapon, site, origin, target: tgt, delay_ms: clamp(body.delay_s, 0, 3600, 0) * 1000 + i * gap, spread_km: spread, origin_spread_km: clamp(body.origin_spread_km, 0, 50, count > 1 ? 6 : 1), outcome });
      if (t) ids.push(t.id);
    }
    return done({ spawned: ids.length, ids });
  }
  if (p === '/threats/intercept-all' && M === 'POST') {
    let n = 0;
    for (const t of liveThreats(now)) {
      if (body.side && t.side !== body.side) continue;
      if (body.type && CLASS[t.weapon.category] !== body.type && t.weapon.category !== body.type) continue;
      endThreat(t, 'intercepted', now); n++;
    }
    return done({ intercepted: n });
  }
  if (p === '/threats/clear' && M === 'POST') {
    let n = 0;
    for (let i = threats.length - 1; i >= 0; i--) if (!body.side || threats[i].side === body.side) { threats.splice(i, 1); n++; }
    invalidate();
    return done({ removed: n });
  }
  if ((m = p.match(/^\/threats\/(TH-\d+)(?:\/(intercept|impact))?$/))) {
    const t = threats.find(x => x.id === m[1]);
    if (!t) return fail(res, 404, 'not_found', 'Threat not found');
    if (M === 'DELETE') { threats.splice(threats.indexOf(t), 1); invalidate(); return done(); }
    if (M === 'POST' && m[2]) { endThreat(t, m[2] === 'impact' ? 'impact' : 'intercepted', now); return done(); }
  }

  // ---- launchers
  if (p === '/sites' && M === 'POST') {
    const lat = clamp(body.lat, -90, 90, NaN), lng = clamp(body.lng, -180, 180, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 400, 'bad_position', 'lat/lng required');
    const side = body.side === 'csb' ? 'csb' : 'du';
    const s = {
      id: 'S-' + (++state.counters.site), name: str(body.name, 60) || 'New launcher', side,
      kind: KINDS.includes(body.kind) ? body.kind : 'land', lat, lng, weapons: cleanWeapons(body.weapons),
      confidence: body.confidence === 'confirmed' ? 'confirmed' : 'assessed', revealed: side === 'csb' ? body.revealed !== false : !!body.revealed, discovered: false, auto: body.auto !== false
    };
    state.sites.push(s); touch();
    return done({ site: s });
  }
  if ((m = p.match(/^\/sites\/([\w-]+)$/))) {
    const s = state.sites.find(x => x.id === m[1]);
    if (!s) return fail(res, 404, 'not_found', 'Launcher not found');
    if (M === 'DELETE') { state.sites.splice(state.sites.indexOf(s), 1); touch(); return done(); }
    if (M === 'PATCH') {
      if (body.name !== undefined) s.name = str(body.name, 60) || s.name;
      if (body.side) s.side = body.side === 'csb' ? 'csb' : 'du';
      if (KINDS.includes(body.kind)) s.kind = body.kind;
      if (body.lat !== undefined) s.lat = clamp(body.lat, -90, 90, s.lat);
      if (body.lng !== undefined) s.lng = clamp(body.lng, -180, 180, s.lng);
      if (body.weapons) s.weapons = cleanWeapons(body.weapons);
      if (body.confidence) s.confidence = body.confidence === 'confirmed' ? 'confirmed' : 'assessed';
      if (body.revealed !== undefined) s.revealed = !!body.revealed;
      if (body.discovered !== undefined) s.discovered = !!body.discovered;
      if (body.auto !== undefined) s.auto = !!body.auto;
      touch(); return done({ site: s });
    }
  }

  // ---- targets
  if (p === '/targets' && M === 'POST') {
    const lat = clamp(body.lat, -90, 90, NaN), lng = clamp(body.lng, -180, 180, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 400, 'bad_position', 'lat/lng required');
    const t = { id: 'T-' + (++state.counters.target), name: str(body.name, 60) || 'New target', owner: body.owner === 'du' ? 'du' : 'csb', lat, lng, weight: clamp(body.weight, 0, 10, 1) };
    state.targets.push(t); touch();
    return done({ target: t });
  }
  if ((m = p.match(/^\/targets\/([\w-]+)$/))) {
    const t = state.targets.find(x => x.id === m[1]);
    if (!t) return fail(res, 404, 'not_found', 'Target not found');
    if (M === 'DELETE') { state.targets.splice(state.targets.indexOf(t), 1); touch(); return done(); }
    if (M === 'PATCH') {
      if (body.name !== undefined) t.name = str(body.name, 60) || t.name;
      if (body.owner) t.owner = body.owner === 'du' ? 'du' : 'csb';
      if (body.weight !== undefined) t.weight = clamp(body.weight, 0, 10, t.weight);
      if (body.lat !== undefined) t.lat = clamp(body.lat, -90, 90, t.lat);
      if (body.lng !== undefined) t.lng = clamp(body.lng, -180, 180, t.lng);
      touch(); return done({ target: t });
    }
  }

  // ---- frontline
  const ringOf = c => {
    if (!Array.isArray(c) || c.length < 3 || c.length > 600) return null;
    const ring = c.map(pt => [clamp(pt[1], -180, 180, NaN), clamp(pt[0], -90, 90, NaN)]);
    if (ring.some(pt => !Number.isFinite(pt[0]) || !Number.isFinite(pt[1]))) return null;
    return [...ring, ring[0]];
  };
  if (p === '/frontline' && M === 'POST') {
    const ring = ringOf(body.coordinates);
    if (!ring) return fail(res, 400, 'bad_polygon', 'coordinates: at least 3 [lat,lng] points');
    const f = { type: 'Feature', properties: { id: 'FL-' + (++state.counters.fl), name: str(body.name, 60) || 'Frontline', note: str(body.note, 140) }, geometry: { type: 'Polygon', coordinates: [ring] } };
    state.frontline.push(f); touch();
    return done({ feature: f });
  }
  if (p === '/frontline/clear' && M === 'POST') { state.frontline = []; touch(); return done(); }
  if ((m = p.match(/^\/frontline\/([\w-]+)$/))) {
    const f = state.frontline.find(x => x.properties.id === m[1]);
    if (!f) return fail(res, 404, 'not_found', 'Frontline zone not found');
    if (M === 'DELETE') { state.frontline.splice(state.frontline.indexOf(f), 1); touch(); return done(); }
    if (M === 'PATCH') {
      if (body.name !== undefined) f.properties.name = str(body.name, 60) || f.properties.name;
      if (body.note !== undefined) f.properties.note = str(body.note, 140);
      if (body.coordinates) { const ring = ringOf(body.coordinates); if (!ring) return fail(res, 400, 'bad_polygon', 'Bad coordinates'); f.geometry = { type: 'Polygon', coordinates: [ring] }; }
      touch(); return done({ feature: f });
    }
  }

  // ---- names
  if (p === '/rename' && M === 'POST') {
    const name = str(body.name, 60);
    if (body.kind === 'zone') {
      if (!ZONE_BY_ID[body.id]) return fail(res, 404, 'not_found', 'Unknown zone');
      if (name) state.names.zones[body.id] = name; else delete state.names.zones[body.id];
    } else if (body.kind === 'group') {
      if (!ZONES.some(z => z.group === body.id)) return fail(res, 404, 'not_found', 'Unknown region');
      if (name) state.names.groups[body.id] = name; else delete state.names.groups[body.id];
    } else return fail(res, 400, 'bad_kind', 'kind must be zone or group');
    invalidate(); touch();
    return done();
  }

  // ---- simulation settings
  if (p === '/config' && M === 'POST') {
    const c = state.config;
    if (body.du_auto !== undefined) c.du_auto = !!body.du_auto;
    if (body.csb_auto !== undefined) c.csb_auto = !!body.csb_auto;
    if (body.intensity !== undefined) c.intensity = clamp(body.intensity, 0.2, 5, c.intensity);
    if (body.time_scale !== undefined) c.time_scale = clamp(body.time_scale, 0.5, 40, c.time_scale);
    touch();
    return done({ config: c });
  }
  return fail(res, 404, 'not_found', 'Unknown endpoint. See GET /api/v1');
}

/* --------------------------------- server -------------------------------- */
const INDEX = {
  name: "Carl's Spelling Bee - Air Alert API",
  version: 'v1',
  fictional: true,
  auth: 'x-api-key header | Authorization: Bearer <key> | ?api_key=<key>',
  get_a_key: 'POST /api/v1/keys  {"name":"my app"}',
  demo_key: DEMO_KEY,
  rate_limit: `${RATE_LIMIT}/min per key per IP`,
  endpoints: {
    'GET /api/v1/alerts': 'Zones (departments / provinces) currently under alert, with dominant threat class',
    'GET /api/v1/alerts/:zoneId': 'One zone + its incoming threats',
    'GET /api/v1/threats': 'Incoming Dutch Union threats. Filters: type (ballistic_missile|cruise_missile|shahed_drone|jet_drone or ballistic|cruise|shahed|jet_drone), weapon, status, zone, group, origin_kind, include=ended|all',
    'GET /api/v1/strikes': "Outgoing Carl's Spelling Bee strikes (same filters)",
    'GET /api/v1/threats/:id': 'One threat/strike incl. full trajectory',
    'GET /api/v1/history': 'Recently intercepted / impacted (?side=du|csb)',
    'GET /api/v1/zones': 'All alert zones (?side=csb|du|all)',
    'GET /api/v1/geometry': 'All map geometry in one request',
    'GET /api/v1/snapshot': 'Alerts + threats + strikes + stats in one call',
    'GET /api/v1/state': 'Frontline, zone names and visible launch sites (changes bump "rev")',
    'GET /api/v1/weapons': 'Weapon catalogue (?owner=du|csb)',
    'GET /api/v1/launch-sites': 'Visible launch sites (?side=du|csb)',
    'GET /api/v1/frontline': 'Frontline GeoJSON',
    'GET /api/v1/territories': 'Territory GeoJSON',
    'GET /api/v1/stats': 'Summary numbers',
    'GET /api/v1/stream': 'Server-sent events, snapshot every 2s'
  }
};

function serveStatic(req, res, url) {
  let f;
  try { f = decodeURIComponent(url.pathname); } catch (_) { res.writeHead(400); return res.end(); }
  if (f === '/') f = '/index.html';
  const root = path.join(__dirname, 'public');
  const full = path.join(root, path.normalize(f));
  if (!full.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(d);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
  const p = url.pathname.replace(/\/+$/, '');

  if (p.startsWith('/api/v1/admin')) { // invisible unless the admin key is right
    if (!isAdmin(req)) return fail(res, 404, 'not_found', 'Unknown endpoint. See GET /api/v1');
    try { return await admin(req, res, url); }
    catch (e) { return fail(res, e.message === 'too_large' ? 413 : 400, 'bad_request', e.message); }
  }
  if (p === '/api/v1/health') return ok(res, { status: 'up' });
  if (p === '/api/v1') return send(res, 200, INDEX);
  if (p === '/api/v1/keys' && req.method === 'POST') {
    let body = {};
    try { body = await readBody(req, 5000); } catch (_) {}
    const key = 'csb_' + crypto.randomBytes(16).toString('hex');
    const name = str(body.name, 60) || 'unnamed';
    state.keys[key] = { name, created: new Date().toISOString() };
    persist();
    return send(res, 201, { ok: true, api_key: key, name, rate_limit_per_min: RATE_LIMIT });
  }
  const auth = authenticate(req, url);
  if (auth.error) return fail(res, auth.error[0], auth.error[1], auth.error[2], auth.headers);
  try { route(req, res, url, auth); } catch (e) { console.error(e); fail(res, 500, 'server_error', 'Something broke', auth.headers); }
}

(async () => {
  await loadState();
  setInterval(() => { try { step(); } catch (e) { console.error(e); } }, 1000);
  setTimeout(() => { autoSpawn('du'); autoSpawn('du'); autoSpawn('csb'); }, 1500);
  scheduleAuto('du'); scheduleAuto('csb');
  http.createServer((req, res) => handle(req, res).catch(e => { console.error(e); try { fail(res, 500, 'server_error', 'Something broke'); } catch (_) {} }))
    .listen(PORT, () => console.log(`CSB Air Alert running on http://localhost:${PORT}  (demo key: ${DEMO_KEY})`));
})();
