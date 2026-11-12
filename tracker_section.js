/* ---------------------------- naval + air tracker ------------------------- */
// All units are simulated. Ships only sail on water, aircraft fly out of real-looking air bases.
const BLOCS = { csb: "Carl's Spelling Bee", du: 'Dutch Union', bu: 'Balkan Union', neutral: 'Independent' };
const SEAS = { // id: [name, [west, south, east, north]]
  north_sea: ['North Sea', [0.5, 52.5, 7.5, 58.5]],
  north_sea_n: ['Northern North Sea', [0, 58.5, 7, 62]],
  channel: ['English Channel', [-5, 49.2, 1.8, 50.9]],
  atlantic_biscay: ['Bay of Biscay', [-9.5, 43.6, -2.5, 48.2]],
  atlantic_west: ['Western Approaches', [-14, 44.5, -6.5, 52]],
  atlantic_sw: ['Atlantic (Iberia)', [-16, 34.5, -7, 43.5]],
  atlantic_nw: ['North Atlantic', [-14, 55.5, -5.5, 60]],
  irish_sea: ['Irish Sea', [-6.3, 52.2, -3.3, 54.8]],
  med_west: ['Western Mediterranean', [-2, 36, 9, 43]],
  ligurian: ['Ligurian / Tyrrhenian Sea', [8, 38.5, 15.5, 44]],
  med_central: ['Central Mediterranean', [9, 33.5, 18, 37.8]],
  ionian: ['Ionian Sea', [15.5, 35.5, 21, 40]],
  adriatic: ['Adriatic Sea', [12.8, 40, 19.3, 45.6]],
  aegean: ['Aegean Sea', [23, 35.5, 28.2, 40.5]],
  med_east: ['Eastern Mediterranean', [21, 33.5, 36, 36.4]],
  black_sea: ['Black Sea', [28.5, 41.3, 41.5, 46.2]],
  baltic: ['Baltic Sea', [11, 54, 24, 59.5]],
  baltic_w: ['Western Baltic', [9, 54.2, 13.5, 56.5]],
  gulf_finland: ['Gulf of Finland', [22, 59.3, 30, 60.4]],
  skagerrak: ['Skagerrak', [7.5, 57, 11.8, 58.8]],
  norwegian_sea: ['Norwegian Sea', [-3, 62, 11, 71]],
  barents: ['Barents Sea', [20, 70.3, 45, 73.5]]
};
const SHIPCLASS = { // code: [id, label, kind, displacement_t, [min_kts, max_kts]]
  CV: ['aircraft_carrier', 'Aircraft carrier', 'surface', 42000, [20, 28]],
  LHD: ['amphibious_assault', 'Amphibious assault ship', 'surface', 24000, [16, 22]],
  CG: ['cruiser', 'Cruiser', 'surface', 11000, [20, 28]],
  DDG: ['destroyer', 'Destroyer', 'surface', 7500, [22, 30]],
  FFG: ['frigate', 'Frigate', 'surface', 4500, [20, 28]],
  FSG: ['corvette', 'Corvette', 'surface', 1800, [18, 26]],
  PC: ['patrol_vessel', 'Patrol vessel', 'surface', 600, [14, 24]],
  MCM: ['minesweeper', 'Mine countermeasures vessel', 'surface', 700, [8, 14]],
  AOR: ['supply_ship', 'Replenishment tanker', 'surface', 21000, [12, 18]],
  LST: ['landing_ship', 'Landing ship', 'surface', 8000, [12, 18]],
  SSBN: ['ballistic_submarine', 'Ballistic missile submarine', 'submarine', 14000, [10, 20]],
  SSN: ['attack_submarine', 'Nuclear attack submarine', 'submarine', 6000, [12, 25]],
  SSK: ['diesel_submarine', 'Diesel-electric submarine', 'submarine', 2200, [6, 14]]
};
const SHIP_NAMES = ['Valiant', 'Resolute', 'Intrepid', 'Sentinel', 'Aurora', 'Meridian', 'Vanguard', 'Triton', 'Hydra', 'Orion', 'Falcon', 'Harbinger', 'Dauntless', 'Endeavour', 'Fortitude', 'Gallant', 'Jupiter', 'Kestrel', 'Leviathan', 'Mariner', 'Neptune', 'Odyssey', 'Pegasus', 'Quest', 'Revenant', 'Sovereign', 'Tempest', 'Unity', 'Vigilant', 'Warden', 'Zephyr', 'Albatross', 'Bastion', 'Corsair', 'Defiant', 'Eclipse', 'Frontier', 'Guardian', 'Highlander', 'Ironside', 'Lionheart', 'Monarch', 'Nimrod', 'Pathfinder', 'Rampart', 'Seahawk', 'Trident', 'Windrush'];

// id, name, bloc, tech, air weight, fleet, ports [name, lat, lng, seas], air bases [name, lat, lng]
const CTRY = [
  ['CSB', "Carl's Spelling Bee", 'csb', 'west', 1, 'CV:1,LHD:1,DDG:3,FFG:4,SSBN:2,SSN:3,PC:2,MCM:2,AOR:1',
    [['Brest', 48.38, -4.49, ['atlantic_biscay', 'atlantic_west', 'channel']], ['Toulon', 43.12, 5.93, ['med_west', 'ligurian']], ['Cherbourg', 49.65, -1.62, ['channel', 'atlantic_west']], ['Lorient', 47.73, -3.36, ['atlantic_biscay', 'atlantic_west']]],
    [['Orléans-Bricy AB', 47.99, 1.76], ['Mont-de-Marsan AB', 43.91, -0.5], ['Istres AB', 43.52, 4.92], ['Luxeuil AB', 47.78, 6.36], ['Saint-Dizier AB', 48.64, 4.9], ['Cambrai AB', 50.22, 3.15], ['Landivisiau AB', 48.53, -4.15]]],
  ['DU', 'Dutch Union', 'du', 'west', 1, 'CV:1,LHD:1,DDG:3,FFG:4,SSBN:1,SSN:2,SSK:1,PC:2,MCM:3,AOR:1',
    [['Den Helder', 52.96, 4.78, ['north_sea']], ['Rotterdam', 51.95, 4.05, ['north_sea', 'channel']], ['Portsmouth', 50.8, -1.1, ['channel', 'atlantic_west']], ['Plymouth', 50.36, -4.15, ['channel', 'atlantic_west']], ['Zeebrugge', 51.33, 3.2, ['north_sea', 'channel']]],
    [['Volkel AB', 51.66, 5.7], ['Leeuwarden AB', 53.23, 5.76], ['Florennes AB', 50.24, 4.65], ['Kleine-Brogel AB', 51.17, 5.47], ['RAF Brize Norton', 51.75, -1.58], ['RAF Odiham', 51.23, -0.94], ['Geilenkirchen AB', 50.96, 6.04], ['Büchel AB', 50.17, 7.06]]],
  // Balkan Union
  ['GR', 'Greece', 'bu', 'balkan', 0.6, 'FFG:3,FSG:2,SSK:2,PC:3,LST:1',
    [['Salamis', 37.95, 23.5, ['aegean', 'med_east']], ['Souda Bay', 35.49, 24.07, ['med_east', 'aegean', 'ionian']]],
    [['Tanagra AB', 38.34, 23.56], ['Souda AB', 35.53, 24.15], ['Larissa AB', 39.65, 22.46]]],
  ['HR', 'Croatia', 'bu', 'balkan', 0.3, 'FSG:1,PC:3', [['Split', 43.5, 16.44, ['adriatic']], ['Pula', 44.87, 13.83, ['adriatic']]], [['Zagreb-Pleso AB', 45.74, 16.07], ['Zemunik AB', 44.1, 15.35], ['Pula AB', 44.89, 13.92]]],
  ['RO', 'Romania', 'bu', 'balkan', 0.5, 'FFG:2,FSG:2,PC:2,MCM:2', [['Constanța', 44.17, 28.66, ['black_sea']]], [['Fetești AB', 44.4, 27.72], ['Câmpia Turzii AB', 46.5, 23.88], ['Mihail Kogălniceanu AB', 44.36, 28.49]]],
  ['BG', 'Bulgaria', 'bu', 'balkan', 0.4, 'FFG:2,FSG:1,PC:2,MCM:1', [['Varna', 43.19, 27.95, ['black_sea']], ['Burgas', 42.48, 27.5, ['black_sea']]], [['Graf Ignatievo AB', 42.29, 24.71], ['Sofia-Vrazhdebna AB', 42.69, 23.41]]],
  ['AL', 'Albania', 'bu', 'balkan', 0.15, 'PC:3', [['Durrës', 41.31, 19.45, ['adriatic', 'ionian']]], [['Kuçovë AB', 40.77, 19.9]]],
  ['ME', 'Montenegro', 'bu', 'balkan', 0.15, 'FSG:1,PC:1', [['Bar', 42.09, 19.09, ['adriatic']]], [['Golubovci AB', 42.36, 19.25]]],
  ['SI', 'Slovenia', 'bu', 'balkan', 0.15, 'PC:1', [['Koper', 45.55, 13.73, ['adriatic']]], [['Cerklje ob Krki AB', 45.9, 15.52]]],
  ['RS', 'Serbia', 'bu', 'balkan', 0.3, '', [], [['Batajnica AB', 44.9, 20.27], ['Niš AB', 43.34, 21.85]]],
  ['HU', 'Hungary', 'bu', 'balkan', 0.3, '', [], [['Kecskemét AB', 46.92, 19.75], ['Pápa AB', 47.36, 17.5]]],
  ['AT', 'Austria', 'bu', 'balkan', 0.3, '', [], [['Zeltweg AB', 47.2, 14.75], ['Hörsching AB', 48.24, 14.19], ['Tulln AB', 48.33, 16.11]]],
  ['MK', 'North Macedonia', 'bu', 'balkan', 0.15, '', [], [['Skopje-Petrovec AB', 41.96, 21.62]]],
  ['XK', 'Kosovo', 'bu', 'balkan', 0.1, '', [], [['Slatina AB', 42.58, 21.04]]],
  ['BA', 'Bosnia and Herzegovina', 'bu', 'balkan', 0.15, '', [], [['Sarajevo AB', 43.82, 18.33]]],
  ['MD', 'Moldova', 'bu', 'balkan', 0.1, '', [], [['Mărculești AB', 47.86, 28.2], ['Chișinău AB', 46.93, 28.93]]],
  // Independent countries
  ['RU', 'Russia', 'neutral', 'east', 1.3, 'CV:1,CG:2,DDG:2,FFG:3,SSBN:2,SSN:2,SSK:2,LST:1,AOR:1',
    [['Baltiysk', 54.64, 19.9, ['baltic']], ['Kronstadt', 59.99, 29.77, ['gulf_finland', 'baltic']], ['Severomorsk', 69.07, 33.42, ['barents', 'norwegian_sea']], ['Novorossiysk', 44.72, 37.77, ['black_sea']], ['Sevastopol', 44.62, 33.53, ['black_sea']]],
    [['Chkalovsk AB', 54.77, 20.4], ['Pskov AB', 57.78, 28.4], ['Kubinka AB', 55.61, 36.65], ['Belgorod AB', 50.64, 36.59], ['Severomorsk AB', 69.0, 33.4], ['Saki AB', 45.09, 33.6]]],
  ['TR', 'Turkey', 'neutral', 'west', 0.8, 'LHD:1,FFG:3,FSG:2,SSK:3,PC:2',
    [['Aksaz', 36.85, 28.37, ['aegean', 'med_east']], ['Izmir', 38.43, 27.14, ['aegean']], ['Iskenderun', 36.6, 36.17, ['med_east']], ['Samsun', 41.29, 36.34, ['black_sea']]],
    [['Eskişehir AB', 39.78, 30.58], ['Konya AB', 37.98, 32.56], ['İncirlik AB', 37.0, 35.43], ['Çiğli AB', 38.51, 27.01], ['Diyarbakır AB', 37.89, 40.2]]],
  ['IT', 'Italy', 'neutral', 'west', 0.7, 'CV:1,LHD:1,DDG:3,FFG:3,SSK:2,PC:2',
    [['Taranto', 40.47, 17.23, ['ionian', 'adriatic']], ['La Spezia', 44.1, 9.83, ['ligurian', 'med_west']], ['Augusta', 37.23, 15.22, ['ionian', 'med_central']]],
    [['Aviano AB', 46.03, 12.6], ['Sigonella AB', 37.4, 14.92], ['Grosseto AB', 42.76, 11.07], ['Pratica di Mare AB', 41.66, 12.45], ['Amendola AB', 41.54, 15.72]]],
  ['ES', 'Spain', 'neutral', 'west', 0.6, 'LHD:1,DDG:3,FFG:2,SSK:2,PC:2',
    [['Rota', 36.62, -6.35, ['atlantic_sw']], ['Cartagena', 37.58, -0.98, ['med_west']], ['Ferrol', 43.47, -8.25, ['atlantic_biscay', 'atlantic_sw']]],
    [['Torrejón AB', 40.49, -3.45], ['Morón AB', 37.17, -5.62], ['Albacete AB', 38.95, -1.86]]],
  ['PT', 'Portugal', 'neutral', 'west', 0.3, 'FFG:2,SSK:1,PC:2', [['Lisbon', 38.7, -9.15, ['atlantic_sw']]], [['Monte Real AB', 39.83, -8.89], ['Beja AB', 38.08, -7.93]]],
  ['NO', 'Norway', 'neutral', 'west', 0.5, 'FFG:3,SSK:2,PC:2', [['Haakonsvern', 60.28, 5.23, ['north_sea_n', 'norwegian_sea']], ['Ramsund', 68.5, 16.5, ['norwegian_sea', 'barents']]], [['Ørland AB', 63.7, 9.6], ['Bodø AB', 67.27, 14.37], ['Evenes AB', 68.49, 16.68]]],
  ['DK', 'Denmark', 'neutral', 'west', 0.4, 'FFG:2,PC:2', [['Frederikshavn', 57.44, 10.54, ['skagerrak', 'baltic_w']]], [['Skrydstrup AB', 55.22, 9.26], ['Karup AB', 56.3, 9.12]]],
  ['SE', 'Sweden', 'neutral', 'west', 0.5, 'FSG:3,SSK:3,PC:2', [['Karlskrona', 56.16, 15.59, ['baltic', 'baltic_w']], ['Muskö', 59.0, 18.1, ['baltic']]], [['Luleå AB', 65.55, 22.12], ['Ronneby AB', 56.27, 15.27], ['Såtenäs AB', 58.43, 12.71]]],
  ['FI', 'Finland', 'neutral', 'west', 0.4, 'FSG:2,PC:2,MCM:2', [['Upinniemi', 60.1, 24.4, ['gulf_finland', 'baltic']]], [['Rovaniemi AB', 66.56, 25.83], ['Tikkakoski AB', 62.4, 25.7]]],
  ['PL', 'Poland', 'neutral', 'west', 0.6, 'FFG:1,FSG:1,SSK:1,PC:2', [['Gdynia', 54.53, 18.55, ['baltic']]], [['Łask AB', 51.55, 19.18], ['Malbork AB', 54.03, 19.13], ['Mińsk Mazowiecki AB', 52.19, 21.65]]],
  ['DE', 'Germany', 'neutral', 'west', 0.7, 'FFG:3,FSG:2,SSK:2,AOR:1', [['Kiel', 54.32, 10.14, ['baltic_w']], ['Rostock', 54.15, 12.1, ['baltic']], ['Cuxhaven', 53.87, 8.7, ['north_sea']]], [['Neuburg AB', 48.71, 11.21], ['Laage AB', 53.92, 12.28], ['Holzdorf AB', 51.77, 13.17]]],
  ['GB', 'United Kingdom', 'neutral', 'west', 0.8, 'CV:1,DDG:3,FFG:3,SSN:3,SSBN:2,PC:2', [['Faslane', 56.07, -4.82, ['atlantic_nw', 'irish_sea']], ['Rosyth', 56.02, -3.43, ['north_sea']]], [['RAF Lossiemouth', 57.71, -3.34], ['RAF Leuchars', 56.37, -2.87], ['RAF Marham', 52.65, 0.55], ['RAF Coningsby', 53.09, -0.17], ['RAF Valley', 53.25, -4.54]]],
  ['UA', 'Ukraine', 'neutral', 'balkan', 0.6, 'FSG:1,PC:2', [['Odesa', 46.49, 30.74, ['black_sea']]], [['Starokostiantyniv AB', 49.75, 27.2], ['Ozerne AB', 50.2, 28.7], ['Myrhorod AB', 49.94, 33.6]]],
  ['IE', 'Ireland', 'neutral', 'west', 0, 'PC:2', [['Haulbowline', 51.84, -8.3, ['atlantic_west', 'irish_sea']]], []],
  ['CH', 'Switzerland', 'neutral', 'west', 0.3, '', [], [['Payerne AB', 46.84, 6.94], ['Meiringen AB', 46.74, 8.1], ['Emmen AB', 47.09, 8.3]]],
  ['CZ', 'Czechia', 'neutral', 'west', 0.3, '', [], [['Čáslav AB', 49.94, 15.38], ['Náměšť AB', 49.16, 16.12]]]
];
const ROLES = {
  fighter: ['Fighter', [8000, 12000], [800, 1000], 'Combat air patrol'],
  bomber: ['Bomber', [9000, 12000], [750, 900], 'Long-range strike transit'],
  transport: ['Transport', [6000, 9500], [600, 760], 'Airlift'],
  tanker: ['Air tanker', [7000, 10000], [650, 800], 'Aerial refuelling'],
  awacs: ['AEW&C', [8000, 10500], [600, 780], 'Airborne early warning'],
  recon: ['Reconnaissance', [13000, 19000], [650, 800], 'Reconnaissance'],
  helicopter: ['Helicopter', [150, 1500], [180, 260], 'Helicopter sortie'],
  drone: ['Drone (UAV)', [4500, 9000], [180, 320], 'ISR / loiter']
};
const MODELS = {
  west: { fighter: ['F-35A', 'Eurofighter Typhoon', 'Rafale', 'Gripen E', 'F-16C', 'F/A-18C'], bomber: ['B-52H', 'B-1B Lancer'], transport: ['A400M', 'C-130J', 'C-17A'], tanker: ['A330 MRTT', 'KC-767', 'KC-135R'], awacs: ['E-3A Sentry', 'E-7 Wedgetail'], recon: ['RC-135W', 'U-2S'], helicopter: ['NH90', 'AH-64E', 'UH-60M', 'H225M'], drone: ['MQ-9B', 'Heron TP', 'Akinci'] },
  east: { fighter: ['Su-35S', 'Su-30SM', 'MiG-31BM', 'MiG-29SMT', 'Su-34'], bomber: ['Tu-95MS', 'Tu-160', 'Tu-22M3'], transport: ['Il-76MD', 'An-124', 'An-26'], tanker: ['Il-78M'], awacs: ['A-50U'], recon: ['Il-20M', 'Tu-214R'], helicopter: ['Ka-52', 'Mi-8MTV', 'Mi-28N'], drone: ['Orion', 'Forpost', 'Orlan-10'] },
  balkan: { fighter: ['F-16C', 'MiG-29', 'Gripen C', 'F-5E', 'Su-25'], bomber: ['Su-24M'], transport: ['C-130H', 'An-26', 'C-27J'], tanker: ['KC-135R'], awacs: ['Saab 340 AEW'], recon: ['An-30'], helicopter: ['Mi-17', 'AS532 Cougar', 'UH-60M'], drone: ['Bayraktar TB2', 'Heron'] }
};
const CALLSIGNS = { fighter: ['VIPER', 'COBRA', 'FALCON', 'RAPTOR', 'TALON', 'HAWK'], bomber: ['DOOM', 'BONE', 'ARES'], transport: ['REACH', 'HERKY', 'CARGO'], tanker: ['SHELL', 'TEXACO', 'ARCO'], awacs: ['SENTRY', 'MAGIC'], recon: ['RIVET', 'OLIVE'], helicopter: ['DUSTOFF', 'PEDRO', 'RAVEN'], drone: ['REAPER', 'HUNTER'] };

const trkScale = () => Math.min(8, state.config.time_scale);
const KN = 1.852;
function destPoint(p, brg, km) {
  const d = km / R, b = rad(brg), la1 = rad(p.lat), lo1 = rad(p.lng);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: deg(la2), lng: ((deg(lo2) + 540) % 360) - 180 };
}
const seaName = (lat, lng) => { for (const [, v] of Object.entries(SEAS)) { const b = v[1]; if (lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]) return v[0]; } return 'Open sea'; };
function randSea(areaId) {
  const b = SEAS[areaId][1];
  for (let i = 0; i < 50; i++) { const p = { lat: rnd(b[1], b[3]), lng: rnd(b[0], b[2]) }; if (!isLand(p.lat, p.lng)) return p; }
  return null;
}
function segClear(a, b, skipKm = 20) {
  const len = dist(a, b), n = Math.max(1, Math.ceil(len / 12));
  for (let i = 1; i < n; i++) {
    const q = lerp(a, b, i / n);
    if (dist(a, q) < skipKm || dist(b, q) < skipKm) continue;
    if (isLand(q.lat, q.lng)) return false;
  }
  return true;
}

const COUNTRY = {}, ships = [], aircraft = [];
let shipSeq = 0, acSeq = 0, flightSeq = 0, lastTrk = Date.now();

function initTracker() {
  const t0 = Date.now();
  for (const [id, name, bloc, tech, w, fleet, ports, bases] of CTRY) {
    COUNTRY[id] = { id, name, bloc, tech, w, fleet, ports: ports.map(([pn, lat, lng, seas]) => ({ name: pn, lat, lng, seas })), bases: bases.map(([bn, lat, lng]) => ({ name: bn, lat, lng })) };
    // a sea point near each port, used as the harbour approach
    for (const port of COUNTRY[id].ports) {
      port.approach = null;
      for (let i = 0; i < 300 && !port.approach; i++) {
        const q = destPoint(port, rnd(0, 360), rnd(8, 70));
        if (!isLand(q.lat, q.lng) && segClear(q, port, 6)) port.approach = q;
      }
    }
  }
  for (const c of Object.values(COUNTRY)) {
    if (!c.fleet) continue;
    const names = SHIP_NAMES.slice().sort(() => Math.random() - 0.5);
    let k = 0;
    for (const part of c.fleet.split(',')) {
      const [code, n] = part.split(':');
      for (let i = 0; i < +n; i++) createShip(c, code, names[k++ % names.length], i);
    }
  }
  // aircraft: seed every country with sorties already in progress
  for (const c of Object.values(COUNTRY)) for (const role of allowedRoles(c)) for (let i = 0; i < roleTarget(c, role); i++) spawnSortie(c, role, rnd(0.05, 0.95));
  console.log(`Tracker ready: ${ships.length} ships, ${aircraft.length} aircraft (${Date.now() - t0} ms)`);
}

/* ---- ships ---- */
function createShip(c, code, name, idx) {
  const cl = SHIPCLASS[code];
  const port = pick(c.ports);
  const v = {
    id: 'SH-' + String(++shipSeq).padStart(4, '0'), name, code, country: c.id, port,
    hull: `${c.id}-${code}${String(11 + idx * 3 + Math.floor(Math.random() * 3))}`,
    pos: { lat: port.lat, lng: port.lng }, heading: rnd(0, 360), speedKts: 0, depth: 0,
    status: 'in_port', route: [], until: Date.now() + rnd(20, 240) * 1000, returning: false, legKts: rnd(cl[4][0], cl[4][1]), seas: port.seas
  };
  ships.push(v);
  if (Math.random() < 0.6) { // start already at sea
    for (let i = 0; i < 6; i++) {
      const p = randSea(pick(port.seas));
      if (p) { v.pos = p; v.status = 'on_patrol'; v.until = Date.now() + rnd(5, 120) * 1000; v.depth = cl[2] === 'submarine' ? Math.round(rnd(40, 300)) : 0; break; }
    }
  }
}
function newPatrolLeg(v, now) {
  for (let i = 0; i < 8; i++) {
    const p = randSea(pick(v.port.seas));
    if (p && segClear(v.pos, p)) {
      v.route = [p]; v.status = 'underway'; v.returning = false;
      const cl = SHIPCLASS[v.code]; v.legKts = rnd(cl[4][0], cl[4][1]);
      if (cl[2] === 'submarine') v.depth = Math.round(rnd(40, 300));
      return true;
    }
  }
  v.until = now + 30000; return false;
}
function stepShip(v, now, dtS, scale) {
  const cl = SHIPCLASS[v.code];
  if (v.status === 'in_port') {
    v.speedKts = 0; v.depth = 0;
    if (now >= v.until) {
      for (let i = 0; i < 8; i++) {
        const p = randSea(pick(v.port.seas));
        if (!p) continue;
        const ap = v.port.approach || v.port;
        if (segClear(ap, p)) { v.route = v.port.approach ? [ap, p] : [p]; v.status = 'underway'; v.returning = false; v.legKts = rnd(cl[4][0], cl[4][1]); if (cl[2] === 'submarine') v.depth = 0; break; }
      }
      if (v.status === 'in_port') v.until = now + 20000;
    }
    return;
  }
  if (v.status === 'on_patrol') {
    v.speedKts = rnd(3, 8); v.heading = (v.heading + rnd(-3, 3) + 360) % 360;
    if (now >= v.until) {
      if (Math.random() < 0.3 && v.port.approach && segClear(v.pos, v.port.approach)) { v.route = [v.port.approach, { lat: v.port.lat, lng: v.port.lng }]; v.status = 'underway'; v.returning = true; v.legKts = rnd(cl[4][0], cl[4][1]) * 0.7; }
      else newPatrolLeg(v, now);
    }
    return;
  }
  // underway
  if (!v.route.length) {
    if (v.returning) { v.status = 'in_port'; v.pos = { lat: v.port.lat, lng: v.port.lng }; v.until = now + rnd(90, 300) * 1000; v.returning = false; v.depth = 0; }
    else { v.status = 'on_patrol'; v.until = now + rnd(40, 150) * 1000; }
    return;
  }
  const wp = v.route[0];
  const remaining = dist(v.pos, wp);
  const stepKm = v.legKts * KN / 3600 * dtS * scale;
  v.heading = bearing(v.pos, wp); v.speedKts = Math.round(v.legKts * 10) / 10;
  if (stepKm >= remaining) { v.pos = { lat: wp.lat, lng: wp.lng }; v.route.shift(); }
  else v.pos = lerp(v.pos, wp, stepKm / remaining);
  if (v.returning && v.route.length === 0) { /* arrived at berth on next tick */ }
}
function shipPub(v) {
  const c = COUNTRY[v.country], cl = SHIPCLASS[v.code];
  const sub = cl[2] === 'submarine';
  return {
    id: v.id, name: v.name, hull: v.hull,
    country: { id: c.id, name: c.name }, bloc: c.bloc, bloc_name: BLOCS[c.bloc],
    class: cl[0], class_label: cl[1], kind: cl[2], displacement_t: cl[3],
    status: v.status, submerged: sub && v.status !== 'in_port' && v.depth > 0,
    position: { lat: r4(v.pos.lat), lng: r4(v.pos.lng) },
    heading_deg: Math.round(v.heading), speed_kts: v.speedKts, depth_m: sub ? v.depth : 0,
    area: v.status === 'in_port' ? v.port.name + ' (port)' : seaName(v.pos.lat, v.pos.lng),
    home_port: { name: v.port.name, lat: v.port.lat, lng: v.port.lng }
  };
}

/* ---- aircraft ---- */
const BASE_COUNT = { fighter: 3, bomber: 1, transport: 1, tanker: 1, awacs: 1, recon: 1, helicopter: 1, drone: 1 };
function allowedRoles(c) {
  const w = c.w, r = [];
  if (w <= 0 || !c.bases.length) return r;
  if (w >= 0.15) r.push('fighter', 'helicopter');
  if (w >= 0.3) r.push('transport');
  if (w >= 0.4) r.push('drone');
  if (w >= 0.7) r.push('tanker', 'awacs');
  if (w >= 0.9) r.push('bomber', 'recon');
  return r;
}
const roleTarget = (c, role) => Math.max(1, Math.round(BASE_COUNT[role] * (role === 'fighter' ? c.w : 1) * (role === 'fighter' ? 3 : 1)));
function routeFor(c, role, base) {
  const a = rnd(0, 360), B = { lat: base.lat, lng: base.lng };
  const P = (p, ang, km) => destPoint(p, ang, km);
  if (role === 'fighter') {
    const center = P(B, a, rnd(100, 320)), k = 3 + Math.floor(Math.random() * 2);
    return [B, ...Array.from({ length: k }, () => P(center, rnd(0, 360), rnd(30, 110))), B];
  }
  if (role === 'bomber') {
    const p1 = P(B, a, rnd(500, 1100));
    return [B, p1, P(p1, a + rnd(-70, 70), rnd(300, 700)), P(B, a + rnd(120, 240), rnd(400, 900)), B];
  }
  if (role === 'transport') {
    const pool = Object.values(COUNTRY).filter(x => x.bloc === c.bloc || c.bloc === 'neutral' && x.bloc === 'neutral').flatMap(x => x.bases).filter(b => dist(b, base) > 150 && b !== base);
    return [B, pool.length ? pick(pool) : P(B, a, 400)];
  }
  if (role === 'tanker' || role === 'awacs') {
    const center = P(B, a, rnd(150, 380)), b = rnd(0, 360), p1 = P(center, b, 40), p2 = P(center, b + 180, 40);
    return [B, p1, p2, p1, p2, p1, p2, B];
  }
  if (role === 'recon') return [B, P(B, a, rnd(300, 600)), P(B, a + rnd(40, 90), rnd(300, 600)), B];
  if (role === 'helicopter') return [B, P(B, a, rnd(30, 80)), P(B, a + rnd(60, 120), rnd(30, 80)), B];
  const center = P(B, a, rnd(80, 220)); // drone
  const loop = Array.from({ length: 4 }, (_, i) => P(center, i * 90 + rnd(-20, 20), rnd(25, 55)));
  return [B, ...loop, ...loop, B];
}
function spawnSortie(c, role, progress = 0) {
  if (!c.bases.length) return;
  const base = pick(c.bases), route = routeFor(c, role, base);
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + dist(route[i - 1], route[i]));
  const total = cum[cum.length - 1];
  const cnt = role === 'fighter' ? pick([1, 2, 2, 3]) : 1;
  const R_ = ROLES[role], flight = 'FL-' + (++flightSeq), callsign = pick(CALLSIGNS[role]) + ' ' + (10 + Math.floor(Math.random() * 80));
  const pool = (MODELS[c.tech][role] || MODELS.west[role]);
  const model = pick(pool);
  for (let i = 0; i < cnt; i++) {
    aircraft.push({
      id: 'AC-' + String(++acSeq).padStart(4, '0'), callsign: callsign.replace(/ (\d+)$/, (m, n) => ' ' + (+n + i)), model, role, country: c.id, base,
      route, cum, total, done: Math.max(0, total * progress - i * 1.5), cruiseAlt: rnd(R_[1][0], R_[1][1]), speed: rnd(R_[2][0], R_[2][1]),
      flight, off: i * 0.012, heading: 0
    });
  }
}
function acPos(a) {
  const { route, cum } = a;
  let i = 0;
  while (i < route.length - 2 && a.done >= cum[i + 1]) i++;
  const len = cum[i + 1] - cum[i] || 1;
  const t = Math.min(1, Math.max(0, (a.done - cum[i]) / len));
  const p = lerp(route[i], route[i + 1], t);
  a.heading = bearing(route[i], route[i + 1]);
  return { lat: p.lat + a.off * Math.cos(rad(a.heading + 90)), lng: p.lng + a.off * Math.sin(rad(a.heading + 90)) };
}
function acAlt(a) {
  const edge = Math.min(a.done, a.total - a.done);
  const k = a.role === 'helicopter' ? 8 : 60;
  return Math.round(a.cruiseAlt * Math.min(1, Math.max(a.role === 'helicopter' ? 0.2 : 0.04, edge / k)));
}
function aircraftPub(a) {
  const c = COUNTRY[a.country], p = acPos(a), R_ = ROLES[a.role];
  return {
    id: a.id, callsign: a.callsign, model: a.model, role: a.role, role_label: R_[0],
    country: { id: c.id, name: c.name }, bloc: c.bloc, bloc_name: BLOCS[c.bloc],
    base: { name: a.base.name, lat: a.base.lat, lng: a.base.lng },
    status: 'airborne', mission: R_[3], flight: a.flight,
    position: { lat: r4(p.lat), lng: r4(p.lng), altitude_m: acAlt(a) },
    heading_deg: Math.round(a.heading), speed_kmh: Math.round(a.speed), mach: Math.round(a.speed / 1225 * 100) / 100,
    progress: Math.round(a.done / a.total * 1000) / 1000
  };
}
function trackerStep(now = Date.now()) {
  const dtS = Math.min(5, (now - lastTrk) / 1000); lastTrk = now;
  const sc = trkScale();
  for (const v of ships) stepShip(v, now, dtS, sc);
  for (let i = aircraft.length - 1; i >= 0; i--) {
    const a = aircraft[i];
    a.done += a.speed * sc * dtS / 3600;
    if (a.done >= a.total) aircraft.splice(i, 1);
  }
}
function trackerSpawn() {
  for (const c of Object.values(COUNTRY)) for (const role of allowedRoles(c)) {
    const have = aircraft.filter(a => a.country === c.id && a.role === role).length;
    if (have < roleTarget(c, role) && Math.random() < 0.6) spawnSortie(c, role, 0);
  }
}
const matchCountry = (id, c, q) => !q || id === q || c.name.toLowerCase() === String(q).toLowerCase();
function listShips(q) {
  let out = ships.map(shipPub);
  const f = (k, fn) => { if (q.get(k)) out = out.filter(fn); };
  f('country', s => matchCountry(s.country.id, s.country, q.get('country')));
  f('bloc', s => s.bloc === q.get('bloc'));
  f('class', s => s.class === q.get('class'));
  f('kind', s => s.kind === q.get('kind'));
  f('status', s => s.status === q.get('status'));
  f('area', s => s.area.toLowerCase().includes(q.get('area').toLowerCase()));
  f('q', s => (s.name + ' ' + s.hull).toLowerCase().includes(q.get('q').toLowerCase()));
  return out;
}
function listAircraft(q) {
  let out = aircraft.map(aircraftPub);
  const f = (k, fn) => { if (q.get(k)) out = out.filter(fn); };
  f('country', a => matchCountry(a.country.id, a.country, q.get('country')));
  f('bloc', a => a.bloc === q.get('bloc'));
  f('role', a => a.role === q.get('role'));
  f('model', a => a.model.toLowerCase().includes(q.get('model').toLowerCase()));
  f('q', a => (a.callsign + ' ' + a.model).toLowerCase().includes(q.get('q').toLowerCase()));
  return out;
}
function fleetSummary() {
  return Object.values(COUNTRY).map(c => {
    const s = ships.filter(v => v.country === c.id), a = aircraft.filter(x => x.country === c.id);
    const by = (arr, fn) => arr.reduce((o, x) => { const k = fn(x); o[k] = (o[k] || 0) + 1; return o; }, {});
    return { id: c.id, name: c.name, bloc: c.bloc, bloc_name: BLOCS[c.bloc], ships: { total: s.length, by_class: by(s, v => SHIPCLASS[v.code][0]), at_sea: s.filter(v => v.status !== 'in_port').length }, aircraft: { total: a.length, by_role: by(a, x => x.role) } };
  });
}
