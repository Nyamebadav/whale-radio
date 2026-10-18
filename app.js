(() => {
'use strict';
const $ = id => document.getElementById(id);
const fmt = (v, p, n) => Math.abs(v).toFixed(3) + '°' + (v >= 0 ? p : n);

// ---------- map ----------
const map = L.map('map', {worldCopyJump: true, minZoom: 2, zoomControl: true}).setView([12, -60], 2);
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/';
L.tileLayer(GIBS + 'BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
  {maxNativeZoom: 8, maxZoom: 10, className: 'base', attribution: 'Base map: NASA Blue Marble via NASA GIBS'}).addTo(map);
const coast = L.tileLayer(GIBS + 'Coastlines_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png',
  {maxNativeZoom: 9, maxZoom: 10, opacity: .5});
coast.addTo(map);
const d = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);   // MUR SST lags ~1 day; use 2 days back
const blank = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const sst = {
  sst: L.tileLayer(GIBS + `GHRSST_L4_MUR_Sea_Surface_Temperature/default/${d}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
    {maxNativeZoom: 7, maxZoom: 10, opacity: .45, errorTileUrl: blank, attribution: `SST: GHRSST MUR L4 (NASA JPL) via NASA GIBS, ${d}`}),
  anom: L.tileLayer(GIBS + `GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies/default/${d}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
    {maxNativeZoom: 7, maxZoom: 10, opacity: .6, errorTileUrl: blank, attribution: `SST anomaly: GHRSST MUR L4 (NASA JPL) via NASA GIBS, ${d}`})
};
function setLayer(v) {
  Object.values(sst).forEach(l => map.removeLayer(l));
  if (sst[v]) sst[v].addTo(map);
  coast.bringToFront();
  $('layerNote').textContent = v === 'sst' ? `Color = sea surface temperature on ${d} (blue cold → red warm). NASA JPL MUR via NASA GIBS.`
    : v === 'anom' ? `Color = how much warmer (red) or cooler (blue) the sea is than normal, ${d}. NASA JPL MUR via NASA GIBS.` : '';
}
$('layer').onchange = e => setLayer(e.target.value);
setLayer($('layer').value);

// ---------- markers ----------
const markers = {};
const FAN_R = 30;                       // pixel radius for stations that share one hydrophone
const fanN = STATIONS.filter(s => s.fan !== undefined).length;
STATIONS.forEach(s => {
  let ax = 10, ay = 10, extra = '';
  if (s.fan !== undefined) {
    const a = -Math.PI / 2 + s.fan * 2 * Math.PI / fanN;
    const dx = Math.round(FAN_R * Math.cos(a)), dy = Math.round(FAN_R * Math.sin(a));
    ax = 10 - dx; ay = 10 - dy;
    const len = Math.hypot(dx, dy) - 9, ang = Math.atan2(-dy, -dx) * 180 / Math.PI;
    extra = `<div class="fanline" style="left:10px;top:10px;width:${len}px;transform:rotate(${ang}deg)"></div>`;
  }
  const icon = L.divIcon({className: '', html: `${extra}<div class="dot" id="dot-${s.id}"></div>`, iconSize: [20, 20], iconAnchor: [ax, ay]});
  markers[s.id] = L.marker([s.lat, s.lon], {icon, title: s.title, alt: s.title, riseOnHover: true}).addTo(map)
    .bindTooltip(`${s.title} · ${s.species}` + (s.fan !== undefined ? '<br><small>Shown fanned out: all five share the MARS hydrophone</small>' : ''))
    .on('click', () => openStation(s.id));
});
L.circleMarker([MARS.lat, MARS.lon], {radius: 3, color: '#fff', weight: 1, fillOpacity: 1}).addTo(map)
  .bindTooltip('MARS hydrophone, 891 m deep (true position)');

// ---------- audio graph ----------
const player = $('player');
let ctx, analyser, current = null, queue = [];
function ensureAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaElementSource(player);
  analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.5;
  src.connect(analyser); analyser.connect(ctx.destination);
  draw();
}
const cv = $('spec'), g = cv.getContext('2d');
g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
function color(v) { const t = v / 255; return `hsl(${260 - 230 * t},90%,${8 + 52 * t}%)`; }
function draw() {
  requestAnimationFrame(draw);
  if (!analyser || player.paused) return;
  const n = analyser.frequencyBinCount, data = new Uint8Array(n); analyser.getByteFrequencyData(data);
  const img = g.getImageData(1, 0, cv.width - 1, cv.height); g.putImageData(img, 0, 0);
  const maxBin = Math.floor(n * 5000 / (ctx.sampleRate / 2));     // show 0–5 kHz
  for (let y = 0; y < cv.height; y++) {
    const f = Math.pow(1 - y / cv.height, 1.6);                   // stretch the low end
    g.fillStyle = color(data[Math.floor(f * maxBin)] || 0); g.fillRect(cv.width - 1, y, 1, 1);
  }
}

let lang = 'en';
const langSel = $('lang');
Object.entries(LANGS).forEach(([k, v]) => langSel.add(new Option(v, k)));
langSel.add(new Option('Twi (coming soon)', 'tw')); langSel.options[langSel.length - 1].disabled = true;
langSel.onchange = e => { lang = e.target.value; };
const narrUrl = s => `narration/${lang}/${s.id}.mp3`;

function setDot(id, on) { const el = $('dot-' + id); if (el) el.classList.toggle('on', on); }
function stop() {
  queue = []; player.pause();
  if (current) setDot(current.s.id, false);
  current = null; $('nowPlaying').textContent = 'Stopped';
  updateButtons();
}
async function playSeq(s, items) {
  ensureAudio(); if (ctx.state === 'suspended') await ctx.resume();
  if (current) setDot(current.s.id, false);
  queue = items.slice(); playNext(s);
}
function playNext(s) {
  const it = queue.shift();
  if (!it) { setDot(s.id, false); current = null; $('nowPlaying').textContent = 'Finished · ' + s.title; updateButtons(); return; }
  current = {s, kind: it};
  player.src = it === 'intro' ? narrUrl(s) : s.file;
  $('nowPlaying').textContent = (it === 'intro' ? '🎙 Auntie CeCe · ' : '🔊 ') + s.title + (it === 'clip' ? ' · ' + s.speed : '');
  setDot(s.id, true); updateButtons();
  player.play().catch(e => { $('nowPlaying').textContent = 'Could not play: ' + e.message; });
}
player.addEventListener('ended', () => current && playNext(current.s));
player.addEventListener('error', () => { $('nowPlaying').textContent = 'Audio failed to load'; });

function updateButtons() {
  const b = $('stopBtn'); if (b) b.disabled = !current;
}
function credit(s) {
  return `<b>${s.org}</b>. License: <a href="${s.licUrl}" target="_blank" rel="noopener">${s.lic}</a>. ` +
    `Recorded ${s.when} at ${s.place}, ${fmt(s.lat, 'N', 'S')} ${fmt(s.lon, 'E', 'W')}${s.approx ? ' (' + s.approx + ')' : ''}. ` +
    `Source: <a href="${s.src}" target="_blank" rel="noopener">${s.src.replace(/^https?:\/\//, '')}</a>. ` +
    `Original file: ${s.raw}. Changes made by Whale Radio: ${s.proc}`;
}
function openStation(id) {
  const s = STATIONS.find(x => x.id === id), p = $('panel');
  p.style.display = 'block';
  const fast = /Sped up/.test(s.speed);
  p.innerHTML = `<span class="tag arch">ARCHIVE</span><span class="tag ${fast ? 'fast' : 'real'}">${fast ? 'SPED UP 10×' : 'REAL SPEED'}</span>` +
    (s.approx ? '<span class="tag approx">APPROX. POSITION</span>' : '') +
    `<h2>${s.title}</h2><h3>${s.species} · ${s.place}</h3>` +
    `<div class="k">${s.when} · ${fmt(s.lat, 'N', 'S')}, ${fmt(s.lon, 'E', 'W')} · ${s.depth}</div>` +
    `<div class="btns"><button id="tuneBtn">▶ Tune in (intro + sound)</button><button class="ghost" id="clipBtn">Sound only</button>` +
    `<button class="ghost" id="introBtn">🎙 Intro only</button><button class="ghost" id="stopBtn">■ Stop</button></div>` +
    `<p>${s.d}</p><p class="k">${fast ? '⏩' : '🎧'} ${s.speed}.</p>` +
    `<div class="credit">${credit(s)}</div>` +
    `<p class="k">Narration: Auntie CeCe (AI voice), ${LANGS[lang] || lang}.</p>`;
  $('tuneBtn').onclick = () => playSeq(s, ['intro', 'clip']);
  $('clipBtn').onclick = () => playSeq(s, ['clip']);
  $('introBtn').onclick = () => playSeq(s, ['intro']);
  $('stopBtn').onclick = stop;
  updateButtons();
  history.replaceState(null, '', '#' + s.id);
}
let idx = -1;
$('next').onclick = () => {
  idx = (idx + 1) % STATIONS.length; const s = STATIONS[idx];
  map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 3), {duration: 1.2});
  openStation(s.id); playSeq(s, ['intro', 'clip']);
};

// ---------- credits ----------
$('creditList').innerHTML = '<ol>' + STATIONS.map(s => `<li><b>${s.title}</b> (${s.species}). ${credit(s)}</li>`).join('') + '</ol>' +
  `<h3>Map and data layers</h3><ul>
   <li>Base map: NASA Blue Marble shaded relief and bathymetry; coastlines. Served by NASA GIBS (Global Imagery Browse Services), part of NASA's Earth Science Data and Information System (ESDIS). NASA imagery is generally not copyrighted; credit NASA.</li>
   <li>Sea surface temperature and anomaly: GHRSST Level 4 MUR Global Foundation SST Analysis, NASA JPL (PO.DAAC), via NASA GIBS. Date shown: ${d}.</li>
   <li>Map library: <a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a> 1.9.4, BSD-2-Clause.</li></ul>
   <h3>Narration</h3><ul><li>Spoken intros are written by Auntie CeCe and voiced with the Kokoro-82M text-to-speech model (Apache 2.0), voice “af_heart”. English now; Twi is planned.</li></ul>
   <h3>Honesty notes</h3><ul>
   <li>Every station plays a <b>recording</b> (archive), not a live stream.</li>
   <li>Blue and fin whale calls are mostly below human hearing, so those clips are <b>sped up 10×</b>, which also raises the pitch 10×. Clips marked “Real speed” are unchanged in speed and pitch.</li>
   <li>The five Monterey Bay stations share one hydrophone; on the map they are fanned out around its true position (white dot).</li>
   <li>The PALAOA species label (Weddell seal) is our identification from the sound, not stated in the archive.</li></ul>
   <p class="k">MBARI Pacific Sound data: CC BY 4.0. PALAOA (AWI/PANGAEA): CC BY 3.0. NOAA PMEL recordings: U.S. Government work; no clip-specific license is stated on the PMEL pages.</p>`;
$('creditsBtn').onclick = () => { $('credits').hidden = false; };
$('closeCredits').onclick = () => { $('credits').hidden = true; };
$('credits').onclick = e => { if (e.target.id === 'credits') $('credits').hidden = true; };

// deep link: #blue, #fin, ...
const h = location.hash.slice(1);
if (STATIONS.some(s => s.id === h)) openStation(h);
window.WR = {STATIONS, openStation, playSeq, stop, player, get analyser() { return analyser; }};
})();
