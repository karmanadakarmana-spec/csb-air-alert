/* ---------------- naval + flight trackers ---------------- */
const TC = { csb: '#4f9dff', du: '#ff3d8b', bu: '#34d399', neutral: '#d1d5db' };
const BLOC_NAME = { csb: "Carl's Spelling Bee", du: 'Dutch Union', bu: 'Balkan Union', neutral: 'Independent' };
const trLayer = { ships: L.layerGroup().addTo(map), aircraft: L.layerGroup().addTo(map) };
const tmk = { ships: {}, aircraft: {} };
let TR = { ships: [], aircraft: [], fetched: 0 };
const TF = { ships: { bloc: '', country: '', cls: '', q: '' }, aircraft: { bloc: '', country: '', cls: '', q: '' } };
const hullD = { ship: 'M12 1 L14.5 9 L14 22 L10 22 L9.5 9 Z' };
const SHIP_SHAPE = {
  aircraft_carrier: { s: 30, d: 'M12 1 L16.5 6 L16.5 22 L7.5 22 L7.5 6 Z', x: '<path d="M9.5 9 H14.5 M9.5 13 H14.5 M9.5 17 H14.5" stroke="#05080c" stroke-width="1" fill="none"/>' },
  amphibious_assault: { s: 25, d: 'M12 1.5 L15.5 6 L15.5 22 L8.5 22 L8.5 6 Z' },
  landing_ship: { s: 22, d: 'M12 3 L15 7 L15 22 L9 22 L9 7 Z' },
  supply_ship: { s: 23, d: 'M12 3 L15 7 L15 22 L9 22 L9 7 Z' },
  cruiser: { s: 22, d: hullD.ship }, destroyer: { s: 20, d: hullD.ship }, frigate: { s: 18, d: hullD.ship }, corvette: { s: 16, d: hullD.ship },
  patrol_vessel: { s: 14, d: 'M12 4 L14 10 L13.5 20 L10.5 20 L10 10 Z' }, minesweeper: { s: 14, d: 'M12 4 L14 10 L13.5 20 L10.5 20 L10 10 Z' },
  ballistic_submarine: { s: 25, sub: 1, d: 'M12 2 C15 2 15.5 6 15.5 12 C15.5 18 15 22 12 22 C9 22 8.5 18 8.5 12 C8.5 6 9 2 12 2 Z' },
  attack_submarine: { s: 21, sub: 1, d: 'M12 2 C15 2 15.5 6 15.5 12 C15.5 18 15 22 12 22 C9 22 8.5 18 8.5 12 C8.5 6 9 2 12 2 Z' },
  diesel_submarine: { s: 18, sub: 1, d: 'M12 2 C15 2 15.5 6 15.5 12 C15.5 18 15 22 12 22 C9 22 8.5 18 8.5 12 C8.5 6 9 2 12 2 Z' }
};
const TRANSPORT_D = 'M12 1 L13.5 8 L23 11 L23 13.5 L13.5 13 L13 20 L16 22 L16 23 L8 23 L8 22 L11 20 L10.5 13 L1 13.5 L1 11 L10.5 8 Z';
const AIR_SHAPE = {
  fighter: { s: 18, d: 'M12 1 L14 9 L22 16 L22 18 L14 15 L13 21 L15 22.5 L9 22.5 L11 21 L10 15 L2 18 L2 16 L10 9 Z' },
  bomber: { s: 25, d: 'M12 1 L14 7 L23 16 L23 19 L14 15 L13 21 L16 23 L8 23 L11 21 L10 15 L1 19 L1 16 L10 7 Z' },
  transport: { s: 22, d: TRANSPORT_D },
  tanker: { s: 24, d: TRANSPORT_D, x: '<path d="M12 5 V0" stroke="#05080c" stroke-width="0"/>' },
  awacs: { s: 24, d: TRANSPORT_D, x: '<circle cx="12" cy="10.5" r="2.6" fill="none" stroke="#05080c" stroke-width="1.3"/>' },
  recon: { s: 22, d: 'M12 2 L13 9 L23 12 L23 13.5 L13 12.5 L12.6 20 L15 22 L9 22 L11.4 20 L11 12.5 L1 13.5 L1 12 L11 9 Z' },
  helicopter: { s: 18, d: 'M12 8 a4 4 0 1 0 0.01 0 Z', x: '<path d="M3 3 L21 21 M21 3 L3 21" stroke-width="2" stroke="currentColor"/>' },
  drone: { s: 14, d: 'M12 3 L18 20 L12 16 L6 20 Z' }
};
function trkIcon(kind, d) {
  const sh = kind === 'ships' ? (SHIP_SHAPE[d.class] || SHIP_SHAPE.frigate) : (AIR_SHAPE[d.role] || AIR_SHAPE.fighter);
  const c = TC[d.bloc], sub = !!sh.sub, op = kind === 'ships' && d.status === 'in_port' ? .5 : 1;
  const stroke = sub ? c : '#05080c';
  const extra = (sh.x || '').replace('currentColor', c);
  const html = `<div class="trk" style="width:${sh.s}px;height:${sh.s}px;opacity:${op}"><div class="rot" style="transform:rotate(${d.heading_deg}deg)"><svg width="${sh.s}" height="${sh.s}" viewBox="0 0 24 24"><path d="${sh.d}" fill="${c}" fill-opacity="${sub ? .5 : 1}" stroke="${stroke}" stroke-width="1.2" ${sub ? 'stroke-dasharray="2.4 1.6"' : ''} stroke-linejoin="round"/>${extra}</svg></div></div>`;
  return L.divIcon({ className: '', html, iconSize: [sh.s, sh.s], iconAnchor: [sh.s / 2, sh.s / 2] });
}
const dot = bloc => `<i class="dot" style="background:${TC[bloc]}"></i>`;
const STATUS = { in_port: 'In port', underway: 'Underway', on_patrol: 'On patrol' };
function trkTip(kind, d) {
  return kind === 'ships'
    ? `${dot(d.bloc)}<b>${esc(d.name)}</b> <span style="color:#8b95a7">${esc(d.hull)}</span><br>${esc(d.class_label)} · ${esc(d.country.name)}<br>${STATUS[d.status]}${d.submerged ? ' · submerged ' + d.depth_m + ' m' : ''}`
    : `${dot(d.bloc)}<b>${esc(d.callsign)}</b> <span style="color:#8b95a7">${esc(d.model)}</span><br>${esc(d.role_label)} · ${esc(d.country.name)}<br>${d.position.altitude_m} m · ${d.speed_kmh} km/h`;
}
function trkPopupHtml(kind, d) {
  if (kind === 'ships') return `${dot(d.bloc)}<b>${esc(d.name)}</b> <span style="color:#8b95a7">${esc(d.hull)}</span><br>${esc(d.class_label)} · ${d.displacement_t.toLocaleString()} t<br>${esc(d.country.name)} <span style="color:#8b95a7">(${esc(d.bloc_name)})</span><br>${STATUS[d.status]}${d.submerged ? ' · <b>submerged</b> at ' + d.depth_m + ' m' : d.kind === 'submarine' ? ' · surfaced' : ''}<br>${esc(d.area)}<br>${d.speed_kts} kt · heading ${d.heading_deg}°<br>Home port: ${esc(d.home_port.name)}<br><span style="color:#8b95a7">${d.position.lat.toFixed(3)}, ${d.position.lng.toFixed(3)}</span>`;
  return `${dot(d.bloc)}<b>${esc(d.callsign)}</b> <span style="color:#8b95a7">${esc(d.model)}</span><br>${esc(d.role_label)} · ${esc(d.mission)}<br>${esc(d.country.name)} <span style="color:#8b95a7">(${esc(d.bloc_name)})</span><br>${d.position.altitude_m.toLocaleString()} m · ${d.speed_kmh} km/h (Mach ${d.mach})<br>Heading ${d.heading_deg}° · from ${esc(d.base.name)}<br><span style="color:#8b95a7">${d.position.lat.toFixed(3)}, ${d.position.lng.toFixed(3)}</span>`;
}
function trkOpen(kind, id) {
  const o = tmk[kind][id]; if (!o) return;
  L.popup().setLatLng(o.m.getLatLng()).setContent(trkPopupHtml(kind, o.d)).openOn(map);
}
function trkFocus(kind, id) {
  const o = tmk[kind][id]; if (!o) return;
  map.flyTo(o.m.getLatLng(), Math.max(map.getZoom(), 6), { duration: .6 });
  setTimeout(() => trkOpen(kind, id), 650);
}
const trkMatch = (kind, d) => {
  const f = TF[kind];
  if (f.bloc && d.bloc !== f.bloc) return false;
  if (f.country && d.country.id !== f.country) return false;
  if (f.cls && (kind === 'ships' ? d.class : d.role) !== f.cls) return false;
  if (f.q && !(kind === 'ships' ? d.name + ' ' + d.hull + ' ' + d.country.name : d.callsign + ' ' + d.model + ' ' + d.country.name).toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
};
function syncKind(kind, list) {
  const reg = tmk[kind], seenIds = new Set(), now = performance.now();
  for (const d of list) {
    seenIds.add(d.id);
    const p = d.position;
    let o = reg[d.id];
    if (!o) {
      const m = L.marker([p.lat, p.lng], { icon: trkIcon(kind, d), zIndexOffset: kind === 'aircraft' ? 300 : 200, bubblingMouseEvents: true, keyboard: false });
      const ref = { m, d, from: { lat: p.lat, lng: p.lng }, to: { lat: p.lat, lng: p.lng }, t0: now };
      m.bindTooltip(() => trkTip(kind, ref.d), { direction: 'top', offset: [0, -6] });
      m.on('click', () => { if (mode && mode.onMap) return; trkOpen(kind, d.id); });
      reg[d.id] = o = ref;
    } else {
      const cur = o.m.getLatLng();
      o.from = { lat: cur.lat, lng: cur.lng }; o.to = { lat: p.lat, lng: p.lng }; o.t0 = now;
      const el = o.m.getElement();
      if (el) {
        const r = el.querySelector('.rot'); if (r) r.style.transform = `rotate(${d.heading_deg}deg)`;
        if (kind === 'ships' && el.firstChild) el.firstChild.style.opacity = d.status === 'in_port' ? .5 : 1;
      }
      o.d = d;
    }
  }
  for (const id of Object.keys(reg)) if (!seenIds.has(id)) { trLayer[kind].removeLayer(reg[id].m); delete reg[id]; }
}
function applyTrackerFilters() {
  for (const kind of ['ships', 'aircraft']) {
    const g = trLayer[kind], show = !hidden.has('trk_' + kind);
    if (show && !map.hasLayer(g)) map.addLayer(g);
    if (!show && map.hasLayer(g)) map.removeLayer(g);
    for (const o of Object.values(tmk[kind])) {
      const vis = trkMatch(kind, o.d);
      if (vis && !g.hasLayer(o.m)) g.addLayer(o.m);
      else if (!vis && g.hasLayer(o.m)) g.removeLayer(o.m);
    }
  }
}
function animTrackers() {
  const now = performance.now();
  for (const kind of ['ships', 'aircraft']) for (const o of Object.values(tmk[kind])) {
    const t = Math.min(1, (now - o.t0) / 3000);
    if (t >= 1 && o._done) continue;
    o._done = t >= 1;
    o.m.setLatLng([o.from.lat + (o.to.lat - o.from.lat) * t, o.from.lng + (o.to.lng - o.from.lng) * t]);
  }
}
async function pollTrackers() {
  try {
    const r = await api('/tracker');
    if (!r.ok) return;
    TR = { ships: r.ships, aircraft: r.aircraft, fetched: Date.now() };
    for (const o of Object.values(tmk.ships)) o._done = false;
    for (const o of Object.values(tmk.aircraft)) o._done = false;
    syncKind('ships', TR.ships); syncKind('aircraft', TR.aircraft);
    applyTrackerFilters();
    renderTrackerLists();
  } catch (_) {}
}

/* ---- Navy / Air tabs ---- */
const TTAB = { ships: '#navy', aircraft: '#air' };
function buildTrackerTabs() {
  for (const kind of ['ships', 'aircraft']) {
    const el = $(TTAB[kind]);
    el.innerHTML = `<div class="tf"><select data-f="bloc"><option value="">All blocs</option>${Object.entries(BLOC_NAME).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><select data-f="country"><option value="">All countries</option></select><select data-f="cls"><option value="">${kind === 'ships' ? 'All ship types' : 'All aircraft types'}</option></select><input data-f="q" placeholder="${kind === 'ships' ? 'Search name or hull…' : 'Search callsign or model…'}"></div><div class="tsum"></div><div class="tlist"></div>`;
    el.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener(inp.tagName === 'INPUT' ? 'input' : 'change', () => {
      TF[kind][inp.dataset.f] = inp.value;
      if (inp.dataset.f === 'bloc') { TF[kind].country = ''; }
      renderTrackerLists(true); applyTrackerFilters();
    }));
  }
}
const optKey = {};
function fillOptions(kind, el) {
  const list = kind === 'ships' ? TR.ships : TR.aircraft, f = TF[kind];
  const countries = new Map(), classes = new Map();
  for (const d of list) {
    if (!f.bloc || d.bloc === f.bloc) countries.set(d.country.id, d.country.name);
    classes.set(kind === 'ships' ? d.class : d.role, kind === 'ships' ? d.class_label : d.role_label);
  }
  const cs = [...countries.entries()].sort((a, b) => a[1].localeCompare(b[1])), ks = [...classes.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const key = f.bloc + '|' + cs.map(x => x[0]).join() + '|' + ks.map(x => x[0]).join();
  if (optKey[kind] === key) return;
  optKey[kind] = key;
  const sc = el.querySelector('[data-f=country]'), sk = el.querySelector('[data-f=cls]');
  sc.innerHTML = '<option value="">All countries</option>' + cs.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
  sk.innerHTML = `<option value="">${kind === 'ships' ? 'All ship types' : 'All aircraft types'}</option>` + ks.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
  sc.value = f.country; sk.value = f.cls;
}
function renderTrackerLists(force) {
  for (const kind of ['ships', 'aircraft']) {
    const el = $(TTAB[kind]); if (!el || !el.querySelector('.tlist')) continue;
    fillOptions(kind, el);
    const all = kind === 'ships' ? TR.ships : TR.aircraft;
    const list = all.filter(d => trkMatch(kind, d));
    const by = {}; for (const d of list) by[d.bloc] = (by[d.bloc] || 0) + 1;
    const blocs = Object.keys(BLOC_NAME).filter(b => by[b]).map(b => `<span class="tag">${dot(b)}${esc(BLOC_NAME[b])} ${by[b]}</span>`).join('');
    let line;
    if (kind === 'ships') line = `<b>${list.length}</b> ships · ${list.filter(d => d.kind === 'submarine').length} submarines · ${list.filter(d => d.class === 'aircraft_carrier').length} carriers · ${list.filter(d => d.status !== 'in_port').length} at sea`;
    else { const r = {}; for (const d of list) r[d.role_label] = (r[d.role_label] || 0) + 1; line = `<b>${list.length}</b> aircraft airborne · ` + Object.entries(r).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', '); }
    el.querySelector('.tsum').innerHTML = line + '<br>' + blocs;
    const tl = el.querySelector('.tlist');
    if (tl.matches(':hover') && !force && tl.innerHTML) continue;
    const order = { csb: 0, du: 1, bu: 2, neutral: 3 };
    const sorted = list.slice().sort((a, b) => order[a.bloc] - order[b.bloc] || a.country.name.localeCompare(b.country.name) || (kind === 'ships' ? a.name.localeCompare(b.name) : a.callsign.localeCompare(b.callsign)));
    tl.innerHTML = sorted.slice(0, 120).map(d => kind === 'ships'
      ? `<div class="card" data-k="ships" data-id="${d.id}" style="border-left-color:${TC[d.bloc]}"><div class="t"><span>${esc(d.name)} <small style="color:#8b95a7;font-weight:400">${esc(d.hull)}</small></span><span class="tag">${STATUS[d.status]}</span></div><div class="m">${esc(d.class_label)} · ${esc(d.country.name)}</div><div class="m">${esc(d.area)} · ${d.speed_kts} kt · ${d.heading_deg}°${d.submerged ? ' · <b>submerged ' + d.depth_m + ' m</b>' : ''}</div></div>`
      : `<div class="card" data-k="aircraft" data-id="${d.id}" style="border-left-color:${TC[d.bloc]}"><div class="t"><span>${esc(d.callsign)} <small style="color:#8b95a7;font-weight:400">${esc(d.model)}</small></span><span class="tag">${esc(d.role_label)}</span></div><div class="m">${esc(d.country.name)} · from ${esc(d.base.name)}</div><div class="m">${d.position.altitude_m.toLocaleString()} m · ${d.speed_kmh} km/h · ${d.heading_deg}° · ${esc(d.mission)}</div></div>`).join('')
      + (sorted.length > 120 ? `<div class="empty" style="margin:8px">Showing 120 of ${sorted.length}. Use the filters above.</div>` : '') || '<div class="empty">Nothing matches the filters.</div>';
    tl.querySelectorAll('.card').forEach(c => c.onclick = () => trkFocus(c.dataset.k, c.dataset.id));
  }
}
function startTrackers() {
  buildTrackerTabs();
  pollTrackers();
  setInterval(pollTrackers, 3000);
  setInterval(animTrackers, 250);
}
