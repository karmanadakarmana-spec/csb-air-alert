'use strict';
/**
 * Carl's Spelling Bee (CSB) - Air Alert API
 * FICTIONAL SIMULATION. Zero dependencies. Run: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const TIME_SCALE = +process.env.TIME_SCALE || 4; // fictional-world time runs this much faster
const KEYS_FILE = path.join(__dirname, 'keys.json');
const DEMO_KEY = 'csb-demo-key';
const RATE_LIMIT = 120; // requests / minute / key

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

/* --------------------------------- world --------------------------------- */
// polygons are [lat, lng]
const TERRITORIES = {
  csb: {
    id: 'csb', name: "Carl's Spelling Bee", color: '#1d4ed8',
    polygon: [[51.05,2.5],[50.72,3.1],[50.35,4.15],[49.95,4.85],[49.5,5.9],[49.45,6.37],[49.1,7.0],[49.05,8.2],[48.4,7.8],[47.6,7.55],[47.5,7.0],[46.4,6.1],[46.1,6.8],[45.8,7.05],[45.1,7.0],[44.1,7.6],[43.78,7.5],[43.5,7.0],[43.1,6.3],[43.3,5.3],[43.4,4.5],[43.0,3.1],[42.45,3.2],[41.95,3.25],[41.3,2.3],[41.15,1.6],[41.6,1.0],[42.2,0.6],[42.5,-0.3],[42.8,-1.5],[43.35,-1.78],[44.0,-1.3],[45.0,-1.2],[46.0,-1.2],[46.8,-2.1],[47.3,-2.5],[47.5,-3.1],[47.8,-4.1],[48.4,-4.8],[48.7,-4.0],[48.85,-3.0],[48.7,-2.0],[48.65,-1.6],[49.3,-1.2],[49.7,-1.9],[49.65,-1.3],[49.4,-0.9],[49.35,0.2],[49.7,1.2],[50.1,1.6],[50.7,1.6]]
  },
  du_continent: {
    id: 'du_continent', name: 'Dutch Union (mainland)', color: '#7f1d4d',
    polygon: [[53.6,6.5],[53.6,8.2],[49.05,8.2],[49.1,7.0],[49.45,6.37],[49.5,5.9],[49.95,4.85],[50.35,4.15],[50.72,3.1],[51.05,2.5],[51.35,3.4],[51.6,4.0],[52.4,4.6],[53.0,4.8],[53.4,6.0]]
  },
  du_england: {
    id: 'du_england', name: 'Dutch Union (southern England)', color: '#7f1d4d',
    polygon: [[50.1,-5.3],[50.7,-3.5],[50.6,-2.0],[50.75,-1.1],[50.8,0.3],[51.0,1.3],[51.35,1.4],[51.5,0.9],[51.7,0.6],[51.75,-0.5],[51.7,-1.9],[51.6,-3.2],[51.2,-4.5],[50.5,-5.2]]
  }
};

const FRONTLINE = [
  { id: 'FL-FLANDERS', name: 'Flanders front', note: 'Dutch Union land push from the north', polygon: [[51.05,2.55],[50.95,3.3],[50.75,3.9],[50.5,3.6],[50.7,2.9],[50.85,2.45]] },
  { id: 'FL-LORRAINE', name: 'Lorraine front', note: 'Contested border zone near Luxembourg', polygon: [[49.55,5.4],[49.6,6.1],[49.4,6.4],[49.15,6.0],[49.3,5.5]] },
  { id: 'FL-BRITTANY', name: 'Brittany landing', note: 'Amphibious landing from the west', polygon: [[48.5,-4.7],[48.5,-4.3],[48.2,-4.3],[48.25,-4.7]] },
  { id: 'FL-COTENTIN', name: 'Cotentin landing', note: 'Small beachhead', polygon: [[49.7,-1.7],[49.7,-1.5],[49.6,-1.5]] }
];

const REGIONS = [
  { id: 'hdf', name: 'Hauts-de-France', lat: 50.0, lng: 2.8, radius_km: 90 },
  { id: 'idf', name: 'Île-de-France', lat: 48.85, lng: 2.4, radius_km: 70 },
  { id: 'nor', name: 'Normandie', lat: 49.1, lng: 0.2, radius_km: 90 },
  { id: 'bre', name: 'Bretagne', lat: 48.2, lng: -2.9, radius_km: 100 },
  { id: 'pdl', name: 'Pays de la Loire', lat: 47.5, lng: -0.8, radius_km: 90 },
  { id: 'cvl', name: 'Centre-Val de Loire', lat: 47.5, lng: 1.7, radius_km: 90 },
  { id: 'ges', name: 'Grand Est', lat: 48.7, lng: 5.8, radius_km: 120 },
  { id: 'bfc', name: 'Bourgogne-Franche-Comté', lat: 47.2, lng: 5.0, radius_km: 100 },
  { id: 'naq', name: 'Nouvelle-Aquitaine', lat: 45.0, lng: 0.2, radius_km: 170 },
  { id: 'ara', name: 'Auvergne-Rhône-Alpes', lat: 45.4, lng: 4.9, radius_km: 130 },
  { id: 'occ', name: 'Occitanie', lat: 43.7, lng: 2.2, radius_km: 140 },
  { id: 'paca', name: "Provence-Alpes-Côte d'Azur", lat: 43.8, lng: 6.0, radius_km: 90 },
  { id: 'cat', name: 'Catalonia (incl. Barcelona)', lat: 41.7, lng: 1.8, radius_km: 90 },
  { id: 'and', name: 'Andorra', lat: 42.55, lng: 1.58, radius_km: 25 },
  { id: 'mco', name: 'Monaco', lat: 43.74, lng: 7.42, radius_km: 15 }
];

const TARGETS = [
  ['Paris','idf',48.8566,2.3522,3],['Lille','hdf',50.6292,3.0573,3],['Amiens','hdf',49.8941,2.2958,1],
  ['Rouen','nor',49.4432,1.0993,1],['Le Havre','nor',49.4944,0.1079,1],['Cherbourg','nor',49.6337,-1.6221,1],
  ['Brest','bre',48.3904,-4.4861,2],['Rennes','bre',48.1173,-1.6778,1],['Nantes','pdl',47.2184,-1.5536,1],
  ['Tours','cvl',47.3941,0.6848,1],['Metz','ges',49.1193,6.1757,3],['Reims','ges',49.2583,4.0317,2],
  ['Strasbourg','ges',48.5734,7.7521,2],['Nancy','ges',48.6921,6.1844,1],['Dijon','bfc',47.322,5.0415,1],
  ['Lyon','ara',45.764,4.8357,2],['Grenoble','ara',45.1885,5.7245,1],['Bordeaux','naq',44.8378,-0.5792,1],
  ['Toulouse','occ',43.6047,1.4442,1],['Montpellier','occ',43.6108,3.8767,1],['Perpignan','occ',42.6887,2.8948,1],
  ['Marseille','paca',43.2965,5.3698,1],['Nice','paca',43.7102,7.262,1],['Monaco','mco',43.7384,7.4246,1],
  ['Andorra la Vella','and',42.5063,1.5218,1],['Barcelona','cat',41.3874,2.1686,2],['Girona','cat',41.9794,2.8214,1],
  ['Tarragona','cat',41.1189,1.2445,1]
].map(([name, region_id, lat, lng, weight]) => ({ name, region_id, lat, lng, weight }));

const WEAPONS = {
  trident_d5: { id: 'trident_d5', name: 'Trident D5', category: 'ballistic_missile', class: 'SLBM (submarine-launched)', platform: 'sea', speed_kmh: 4200, apex_km: 110, range_km: 7000, intercept_chance: 0.45, notes: 'Submarine-launched ballistic missile' },
  hammer_b3: { id: 'hammer_b3', name: 'Hammer-B3', category: 'ballistic_missile', class: 'Road-mobile ballistic missile (fictional)', platform: 'land', speed_kmh: 3200, apex_km: 60, range_km: 1500, intercept_chance: 0.5, notes: 'Only confirmed at London launcher batteries (CSB Intelligence)' },
  storm_shadow: { id: 'storm_shadow', name: 'Storm Shadow', category: 'cruise_missile', class: 'Air-launched cruise missile', platform: 'air', speed_kmh: 950, apex_km: 0.1, range_km: 560, intercept_chance: 0.6, notes: 'Low-altitude, terrain hugging' },
  shahed_136: { id: 'shahed_136', name: 'Shahed-136', category: 'shahed_drone', class: 'Propeller loitering munition', platform: 'land/sea', speed_kmh: 185, apex_km: 0.25, range_km: 2500, intercept_chance: 0.8, notes: 'Slow, often launched in salvos' },
  shahed_238: { id: 'shahed_238', name: 'Shahed-238', category: 'jet_drone', class: 'Jet-powered loitering munition', platform: 'land/sea', speed_kmh: 600, apex_km: 0.5, range_km: 1500, intercept_chance: 0.65, notes: 'Jet-powered, much faster than the 136' },
  falcon_j: { id: 'falcon_j', name: 'Falcon-J', category: 'jet_drone', class: 'Jet attack drone (fictional)', platform: 'land', speed_kmh: 800, apex_km: 0.6, range_km: 1200, intercept_chance: 0.6, notes: 'Fictional Dutch Union jet drone' }
};

const LAUNCH_SITES = [
  { id: 'LON-1', name: 'London - Central battery', kind: 'land', lat: 51.51, lng: -0.13, weapons: ['hammer_b3'], confidence: 'confirmed', always_visible: true },
  { id: 'LON-2', name: 'London - South-west battery', kind: 'land', lat: 51.46, lng: -0.31, weapons: ['hammer_b3'], confidence: 'confirmed', always_visible: true },
  { id: 'LON-3', name: 'London - East battery', kind: 'land', lat: 51.58, lng: 0.07, weapons: ['hammer_b3'], confidence: 'confirmed', always_visible: true },
  { id: 'LON-4', name: 'London - South battery', kind: 'land', lat: 51.40, lng: -0.05, weapons: ['hammer_b3'], confidence: 'confirmed', always_visible: true },
  { id: 'DU-RTM', name: 'Rotterdam area', kind: 'land', lat: 51.92, lng: 4.48, weapons: ['shahed_136','shahed_238','falcon_j'], confidence: 'assessed' },
  { id: 'DU-ANR', name: 'Antwerp area', kind: 'land', lat: 51.22, lng: 4.4, weapons: ['shahed_136','shahed_238','falcon_j'], confidence: 'assessed' },
  { id: 'DU-BRU', name: 'Brussels area', kind: 'land', lat: 50.85, lng: 4.35, weapons: ['shahed_136','shahed_238','falcon_j'], confidence: 'assessed' },
  { id: 'DU-LUX', name: 'Luxembourg', kind: 'land', lat: 49.61, lng: 6.13, weapons: ['shahed_136','shahed_238'], confidence: 'assessed' },
  { id: 'DU-CGN', name: 'Cologne area', kind: 'land', lat: 50.94, lng: 6.96, weapons: ['shahed_136','shahed_238','falcon_j'], confidence: 'assessed' },
  { id: 'DU-DUS', name: 'Düsseldorf area', kind: 'land', lat: 51.23, lng: 6.78, weapons: ['shahed_136','falcon_j'], confidence: 'assessed' },
  { id: 'SEA-NORTH', name: 'North Sea', kind: 'sea', lat: 53.8, lng: 3.0, weapons: ['trident_d5','shahed_136'], confidence: 'assessed' },
  { id: 'SEA-CHAN', name: 'English Channel', kind: 'sea', lat: 50.3, lng: -0.5, weapons: ['trident_d5','shahed_136','shahed_238'], confidence: 'assessed' },
  { id: 'SEA-WEST', name: 'Atlantic, west of Brittany', kind: 'sea', lat: 47.2, lng: -8.0, weapons: ['trident_d5','shahed_136','shahed_238'], confidence: 'assessed' },
  { id: 'SEA-BISC', name: 'Bay of Biscay', kind: 'sea', lat: 44.5, lng: -5.5, weapons: ['trident_d5'], confidence: 'assessed' },
  { id: 'AIR-NS', name: 'Air-launch box, North Sea', kind: 'air', lat: 52.4, lng: 2.6, weapons: ['storm_shadow'], confidence: 'assessed' },
  { id: 'AIR-CH', name: 'Air-launch box, Channel', kind: 'air', lat: 50.4, lng: -1.2, weapons: ['storm_shadow'], confidence: 'assessed' }
];

/* ------------------------------- simulation ------------------------------ */
const threats = [];
let seq = 100;
const regionSince = {}; // regionId -> ms

function spawn(opts = {}) {
  const site = opts.site || pick(LAUNCH_SITES.filter(s => !opts.kind || s.kind === opts.kind));
  const weapon = WEAPONS[opts.weapon || pick(site.weapons)];
  const range = Math.min(weapon.range_km, weapon.id === 'shahed_136' ? 800 : 1300);
  let pool = TARGETS.filter(t => dist(site, t) <= range);
  if (!pool.length) return null;
  const target = opts.target || (() => {
    const total = pool.reduce((s, t) => s + t.weight, 0);
    let x = Math.random() * total;
    for (const t of pool) { if ((x -= t.weight) <= 0) return t; }
    return pool[0];
  })();
  const origin = { lat: site.lat + rnd(-0.04, 0.04), lng: site.lng + rnd(-0.04, 0.04) };
  const distance_km = dist(origin, target);
  const dest = { lat: target.lat + rnd(-0.03, 0.03), lng: target.lng + rnd(-0.03, 0.03) };
  const flight_s = Math.max(90, distance_km / (weapon.speed_kmh * TIME_SCALE) * 3600);
  const willIntercept = Math.random() < weapon.intercept_chance;
  const t = {
    id: 'TH-' + String(++seq).padStart(6, '0'),
    weapon, site, origin, dest, target, distance_km,
    launched_ms: Date.now() + (opts.delay_ms || 0),
    flight_s, willIntercept, interceptAt: rnd(0.7, 0.95),
    ended_ms: null, end_status: null, end_pos: null
  };
  threats.push(t);
  return t;
}

function progressOf(t, now = Date.now()) {
  return Math.max(0, (now - t.launched_ms) / 1000 / t.flight_s);
}

function altitudeM(t, p) {
  const apex = t.weapon.apex_km * 1000;
  if (t.weapon.category === 'ballistic_missile') return Math.round(Math.sin(Math.PI * Math.min(1, p)) * apex);
  return Math.round(apex * (0.8 + 0.2 * Math.sin(p * 12)));
}

function step(now = Date.now()) {
  for (const t of threats) {
    if (t.ended_ms) continue;
    const p = progressOf(t, now);
    if (t.willIntercept && p >= t.interceptAt) {
      t.ended_ms = now; t.end_status = 'intercepted'; t.end_pos = lerp(t.origin, t.dest, t.interceptAt);
    } else if (p >= 1) {
      t.ended_ms = now; t.end_status = 'impact'; t.end_pos = { lat: t.dest.lat, lng: t.dest.lng };
    }
  }
  // drop old
  for (let i = threats.length - 1; i >= 0; i--) {
    if (threats[i].ended_ms && now - threats[i].ended_ms > 15 * 60 * 1000) threats.splice(i, 1);
  }
  // alert bookkeeping
  const active = alertsNow(now);
  const ids = new Set(active.map(a => a.region_id));
  for (const id of ids) if (!regionSince[id]) regionSince[id] = now;
  for (const id of Object.keys(regionSince)) if (!ids.has(id)) delete regionSince[id];
}

function liveThreats(now = Date.now()) { return threats.filter(t => !t.ended_ms && now >= t.launched_ms); }

function regionsHit(t, pos) {
  const out = new Set([t.target.region_id]);
  for (const r of REGIONS) if (dist(pos, r) <= r.radius_km + 60) out.add(r.id);
  return [...out];
}

function serialize(t, now = Date.now(), detail = false) {
  const p = t.ended_ms ? (t.end_status === 'intercepted' ? t.interceptAt : 1) : Math.min(1, progressOf(t, now));
  const pos = t.ended_ms ? t.end_pos : lerp(t.origin, t.dest, p);
  const status = t.ended_ms ? t.end_status : (p < 0.08 ? 'launched' : 'inbound');
  const remaining = t.ended_ms ? 0 : Math.max(0, Math.round(t.flight_s * (1 - p)));
  const o = {
    id: t.id,
    status,
    type: t.weapon.category,
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
    origin: {
      site_id: t.site.id, name: t.site.name, kind: t.site.kind,
      lat: r4(t.origin.lat), lng: r4(t.origin.lng), confidence: t.site.confidence
    },
    target: { name: t.target.name, region_id: t.target.region_id, lat: r4(t.dest.lat), lng: r4(t.dest.lng) },
    distance_km: Math.round(t.distance_km),
    threatened_regions: regionsHit(t, pos),
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

function alertsNow(now = Date.now()) {
  const live = liveThreats(now);
  const map = {};
  for (const t of live) {
    const pos = lerp(t.origin, t.dest, Math.min(1, progressOf(t, now)));
    for (const id of regionsHit(t, pos)) {
      (map[id] = map[id] || []).push(t);
    }
  }
  return Object.entries(map).map(([id, ts]) => {
    const r = REGIONS.find(x => x.id === id);
    const direct = ts.some(t => t.target.region_id === id);
    const etas = ts.map(t => Math.max(0, Math.round(t.flight_s * (1 - Math.min(1, progressOf(t, now))))));
    return {
      region_id: id, name: r.name, lat: r.lat, lng: r.lng,
      level: ts.some(t => t.weapon.category === 'ballistic_missile' || t.weapon.category === 'cruise_missile') && direct ? 'critical' : 'alert',
      since: new Date(regionSince[id] || now).toISOString(),
      threat_count: ts.length,
      threat_types: [...new Set(ts.map(t => t.weapon.category))],
      weapons: [...new Set(ts.map(t => t.weapon.name))],
      threat_ids: ts.map(t => t.id),
      nearest_eta_seconds: Math.min(...etas),
      directly_targeted: direct
    };
  }).sort((a, b) => a.nearest_eta_seconds - b.nearest_eta_seconds);
}

function stats(now = Date.now()) {
  const live = liveThreats(now);
  const ended = threats.filter(t => t.ended_ms);
  const byType = {};
  for (const t of live) byType[t.weapon.category] = (byType[t.weapon.category] || 0) + 1;
  return {
    active_threats: live.length,
    active_by_type: byType,
    regions_under_alert: alertsNow(now).length,
    last_15min: {
      intercepted: ended.filter(t => t.end_status === 'intercepted').length,
      impacts: ended.filter(t => t.end_status === 'impact').length
    },
    time_scale: TIME_SCALE,
    server_time: new Date(now).toISOString()
  };
}

// Spawner
function scheduleSpawn() {
  const live = liveThreats().length;
  if (live < 14) {
    const r = Math.random();
    if (r < 0.28) { // drone salvo
      const site = pick(LAUNCH_SITES.filter(s => s.weapons.includes('shahed_136')));
      const first = spawn({ site, weapon: 'shahed_136' });
      if (first) {
        const n = 2 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) spawn({ site, weapon: pick(['shahed_136','shahed_136','shahed_238']), target: first.target, delay_ms: (i + 1) * 1500 });
      }
    } else if (r < 0.5) spawn({ kind: 'land', site: pick(LAUNCH_SITES.filter(s => s.id.startsWith('LON'))) });
    else spawn();
  }
  setTimeout(scheduleSpawn, rnd(7000, 18000));
}
spawn({ site: LAUNCH_SITES[0] });
spawn({ kind: 'sea' });
spawn({ weapon: 'shahed_136', site: LAUNCH_SITES.find(s => s.id === 'DU-LUX') });
setTimeout(scheduleSpawn, 5000);
setInterval(() => step(), 1000);

/* --------------------------------- auth ---------------------------------- */
let KEYS = {};
try { KEYS = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch (_) {}
KEYS[DEMO_KEY] = { name: 'public demo key', created: '2026-01-01T00:00:00.000Z' };
const saveKeys = () => { try { fs.writeFileSync(KEYS_FILE, JSON.stringify(KEYS, null, 2)); } catch (_) {} };
const buckets = {};

function authenticate(req, url) {
  const h = req.headers;
  let key = h['x-api-key'] || url.searchParams.get('api_key');
  const a = h['authorization'];
  if (!key && a && /^Bearer /i.test(a)) key = a.slice(7).trim();
  if (!key) return { error: [401, 'missing_api_key', 'Provide a key via the x-api-key header, Authorization: Bearer, or ?api_key=. Get one with POST /api/v1/keys'] };
  if (!KEYS[key]) return { error: [401, 'invalid_api_key', 'Unknown API key'] };
  const now = Date.now();
  const b = buckets[key] = buckets[key] && buckets[key].reset > now ? buckets[key] : { count: 0, reset: now + 60000 };
  b.count++;
  if (b.count > RATE_LIMIT) return { error: [429, 'rate_limited', `Limit is ${RATE_LIMIT} requests/minute`], headers: { 'Retry-After': Math.ceil((b.reset - now) / 1000) } };
  return { key, headers: { 'X-RateLimit-Limit': RATE_LIMIT, 'X-RateLimit-Remaining': RATE_LIMIT - b.count } };
}

/* --------------------------------- http ---------------------------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function send(res, code, body, headers = {}) {
  const base = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'x-api-key, authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...headers
  };
  res.writeHead(code, base);
  res.end(JSON.stringify(body, null, 2));
}
const ok = (res, data, h) => send(res, 200, { ok: true, simulation: true, generated_at: new Date().toISOString(), ...data }, h);
const fail = (res, code, err, msg, h) => send(res, code, { ok: false, error: err, message: msg }, h);

function geojson(features) { return { type: 'FeatureCollection', features }; }
const poly = (coords) => ({ type: 'Polygon', coordinates: [[...coords.map(([la, lo]) => [lo, la]), [coords[0][1], coords[0][0]]]] });

function route(req, res, url, auth) {
  const p = url.pathname.replace(/\/+$/, '');
  const q = url.searchParams;
  const H = auth.headers;
  const now = Date.now();

  if (p === '/api/v1/alerts') {
    const a = alertsNow(now);
    return ok(res, { active_count: a.length, clear_regions: REGIONS.filter(r => !a.some(x => x.region_id === r.id)).map(r => r.id), alerts: a }, H);
  }
  let m;
  if ((m = p.match(/^\/api\/v1\/alerts\/([\w-]+)$/))) {
    const r = REGIONS.find(x => x.id === m[1]);
    if (!r) return fail(res, 404, 'not_found', 'Unknown region id', H);
    const a = alertsNow(now).find(x => x.region_id === r.id);
    if (!a) return ok(res, { region_id: r.id, name: r.name, level: 'clear', threats: [] }, H);
    return ok(res, { ...a, threats: a.threat_ids.map(id => serialize(threats.find(t => t.id === id), now)) }, H);
  }
  if (p === '/api/v1/threats') {
    let list = threats.filter(t => now >= t.launched_ms);
    const include = q.get('include');
    if (include !== 'ended' && include !== 'all') list = list.filter(t => !t.ended_ms);
    if (include === 'ended') list = list.filter(t => t.ended_ms);
    let out = list.map(t => serialize(t, now));
    if (q.get('type')) out = out.filter(t => t.type === q.get('type'));
    if (q.get('weapon')) out = out.filter(t => t.weapon.id === q.get('weapon'));
    if (q.get('status')) out = out.filter(t => t.status === q.get('status'));
    if (q.get('region')) out = out.filter(t => t.threatened_regions.includes(q.get('region')));
    if (q.get('origin_kind')) out = out.filter(t => t.origin.kind === q.get('origin_kind'));
    out.sort((a, b) => a.eta_seconds - b.eta_seconds);
    return ok(res, { count: out.length, threats: out }, H);
  }
  if ((m = p.match(/^\/api\/v1\/threats\/(TH-\d+)$/))) {
    const t = threats.find(x => x.id === m[1]);
    if (!t) return fail(res, 404, 'not_found', 'Threat not found (it may have expired)', H);
    return ok(res, { threat: serialize(t, now, true) }, H);
  }
  if (p === '/api/v1/history') {
    const out = threats.filter(t => t.ended_ms).sort((a, b) => b.ended_ms - a.ended_ms).map(t => serialize(t, now));
    return ok(res, { count: out.length, threats: out }, H);
  }
  if (p === '/api/v1/regions') return ok(res, { count: REGIONS.length, regions: REGIONS }, H);
  if (p === '/api/v1/weapons') return ok(res, { count: Object.keys(WEAPONS).length, weapons: Object.values(WEAPONS) }, H);
  if (p === '/api/v1/launch-sites') {
    return ok(res, { count: LAUNCH_SITES.length, note: 'Only London ballistic batteries are confirmed so far; the rest are assessed by CSB Intelligence.', launch_sites: LAUNCH_SITES }, H);
  }
  if (p === '/api/v1/frontline') {
    return ok(res, { geojson: geojson(FRONTLINE.map(f => ({ type: 'Feature', properties: { id: f.id, name: f.name, note: f.note }, geometry: poly(f.polygon) }))) }, H);
  }
  if (p === '/api/v1/territories') {
    return ok(res, { geojson: geojson(Object.values(TERRITORIES).map(t => ({ type: 'Feature', properties: { id: t.id, name: t.name, color: t.color }, geometry: poly(t.polygon) }))) }, H);
  }
  if (p === '/api/v1/stats') return ok(res, { stats: stats(now) }, H);
  if (p === '/api/v1/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const push = () => {
      const n = Date.now();
      res.write(`event: snapshot\ndata: ${JSON.stringify({ alerts: alertsNow(n), threats: liveThreats(n).map(t => serialize(t, n)), stats: stats(n) })}\n\n`);
    };
    push();
    const iv = setInterval(push, 2000);
    req.on('close', () => clearInterval(iv));
    return;
  }
  return fail(res, 404, 'not_found', 'Unknown endpoint. See GET /api/v1', H);
}

const INDEX = {
  name: "Carl's Spelling Bee - Air Alert API",
  version: 'v1',
  fictional: true,
  auth: 'x-api-key header | Authorization: Bearer <key> | ?api_key=<key>',
  get_a_key: 'POST /api/v1/keys  {"name":"my app"}',
  demo_key: DEMO_KEY,
  rate_limit: `${RATE_LIMIT}/min per key`,
  endpoints: {
    'GET /api/v1/alerts': 'Regions currently under alert',
    'GET /api/v1/alerts/:regionId': 'One region + its incoming threats',
    'GET /api/v1/threats': 'Live threats. Filters: type, weapon, status, region, origin_kind, include=ended|all',
    'GET /api/v1/threats/:id': 'One threat incl. full trajectory',
    'GET /api/v1/history': 'Recently intercepted / impacted',
    'GET /api/v1/regions': 'All regions',
    'GET /api/v1/weapons': 'Weapon catalogue',
    'GET /api/v1/launch-sites': 'Known / assessed launch sites',
    'GET /api/v1/frontline': 'Frontline GeoJSON',
    'GET /api/v1/territories': 'Territory GeoJSON',
    'GET /api/v1/stats': 'Summary numbers',
    'GET /api/v1/stream': 'Server-sent events, snapshot every 2s'
  }
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!url.pathname.startsWith('/api/')) {
    let f = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.join(__dirname, 'public', path.normalize(f).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
    return fs.readFile(full, (e, d) => {
      if (e) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(d);
    });
  }
  const p = url.pathname.replace(/\/+$/, '');
  if (p === '/api/v1/health') return ok(res, { status: 'up', time_scale: TIME_SCALE });
  if (p === '/api/v1') return send(res, 200, INDEX);
  if (p === '/api/v1/keys' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 5000) req.destroy(); });
    req.on('end', () => {
      let name = 'unnamed';
      try { name = String(JSON.parse(body || '{}').name || 'unnamed').slice(0, 60); } catch (_) {}
      const key = 'csb_' + crypto.randomBytes(16).toString('hex');
      KEYS[key] = { name, created: new Date().toISOString() };
      saveKeys();
      send(res, 201, { ok: true, api_key: key, name, rate_limit_per_min: RATE_LIMIT });
    });
    return;
  }
  const auth = authenticate(req, url);
  if (auth.error) return fail(res, auth.error[0], auth.error[1], auth.error[2], auth.headers);
  try { route(req, res, url, auth); } catch (e) { console.error(e); fail(res, 500, 'server_error', 'Something broke', auth.headers); }
}).listen(PORT, () => console.log(`CSB Air Alert running on http://localhost:${PORT}  (demo key: ${DEMO_KEY})`));