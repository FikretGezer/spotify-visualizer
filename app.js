// ==== CONFIG: Client ID config.js dosyasında (config.example.js'e bak)
import { CLIENT_ID } from './config.js';
const REDIRECT_URI = 'http://127.0.0.1:8888/';
const SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';

const $ = id => document.getElementById(id);
const WIDGET = new URLSearchParams(location.search).has('widget') || location.hash === '#widget';
const BG = new URLSearchParams(location.search).has('bg');   // arka plan visualizer: sadece animasyon
if (BG) {
  document.body.classList.add('bg'); setTimeout(() => captureAudio(), 800);
  const q = new URLSearchParams(location.search);
  document.body.style.setProperty('--rx', q.get('rx') || '50%'); document.body.style.setProperty('--ry', q.get('ry') || '50%');
  window.widget.onReveal(() => requestAnimationFrame(() => document.body.classList.add('shown')));
  window.widget.onUnreveal(() => { document.body.classList.add('hiding'); document.body.classList.remove('shown'); });
}
if (WIDGET) document.body.classList.add('widget');
const msg = t => ($('msg').textContent = t || '');

// ---------- PKCE auth ----------
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function login() {
  if (CLIENT_ID.startsWith('BURAYA')) return msg('app.js içindeki CLIENT_ID\'yi doldur.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
  localStorage.setItem('pkce_verifier', verifier);
  localStorage.setItem('scopes', SCOPES);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const p = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI,
    scope: SCOPES, code_challenge_method: 'S256', code_challenge: challenge });
  location.href = 'https://accounts.spotify.com/authorize?' + p;
}
async function tokenRequest(body) {
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }) });
  if (!r.ok) { const e = new Error('token ' + r.status); e.status = r.status; throw e; }
  const j = await r.json();
  localStorage.setItem('access_token', j.access_token);
  if (j.refresh_token) localStorage.setItem('refresh_token', j.refresh_token);
  localStorage.setItem('expires_at', Date.now() + j.expires_in * 1000 - 60000);
}
async function handleRedirect() {
  const code = new URLSearchParams(location.search).get('code');
  if (!code) return;
  history.replaceState(null, '', WIDGET ? '/?widget' : REDIRECT_URI);
  await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
    code_verifier: localStorage.getItem('pkce_verifier') });
}
async function getToken() {
  if (!localStorage.getItem('access_token')) return null;
  // yeni izin eklendiyse yeniden giriş iste
  if (localStorage.getItem('scopes') !== SCOPES) { localStorage.removeItem('access_token'); $('login').hidden = false; msg('Yeni özellikler için tekrar bağlan.'); return null; }
  if (Date.now() > +localStorage.getItem('expires_at')) {
    // tek seferde tek yenileme: refresh token tek kullanımlık, paralel istekler girişi bozuyordu
    refreshing ||= tokenRequest({ grant_type: 'refresh_token', refresh_token: localStorage.getItem('refresh_token') })
      .finally(() => { refreshing = null; });
    try { await refreshing; }
    catch (e) {
      // sadece Spotify girişi gerçekten iptal ettiyse çıkış yap; ağ hatasında oturumu koru
      if (e.status === 400 || e.status === 401) {
        ['access_token', 'refresh_token', 'expires_at'].forEach(k => localStorage.removeItem(k));
        $('login').hidden = false;
      }
      return null;
    }
  }
  return localStorage.getItem('access_token');
}
let refreshing = null;

// ---------- Now playing ----------
let track = null, progressBase = 0, progressAt = 0, playing = false, duration = 1;
let palette = [[29,185,84],[120,60,200],[255,80,120]];
async function poll() {
  const t = await getToken();
  if (!t) return;
  $('login').hidden = true;
  try {
    const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: 'Bearer ' + t } });
    if (r.status === 204) { msg(WIDGET ? '' : 'Şu an çalan bir şey yok.'); playing = false; if (!track) restoreLast(); return; }
    if (!r.ok) return msg('Spotify API hatası: ' + r.status);
    const j = await r.json(); msg('');
    playing = j.is_playing; context = j.context?.uri || null;
    if (!dragging && performance.now() > seekLock) { progressBase = j.progress_ms; progressAt = performance.now(); }
    const it = j.item; if (!it) return;
    duration = it.duration_ms;
    if (track !== it.id) {
      track = it.id;
      if (BG) loadLyrics(it);
      $('left').hidden = false;
      // yeni şarkı sıradaki listede varsa liste ona doğru yumuşakça kayar; başlık liste yenilenince değişir
      const k = queueItems.findIndex(q => q.id === it.id) + 1;
      pendingNow = { name: it.name, artist: (it.artists || []).map(a => a.name).join(', '), img: it.album?.images?.at(-1)?.url || it.album?.images?.[0]?.url || '' };
      if (k > 0 && $('queue').children.length > 1) { shift = k; arcTarget = k; resetArc = false; }
      else { shift = 0; resetArc = true; }
      const img = it.album?.images?.[0]?.url;
      try { localStorage.setItem('lastTrack', JSON.stringify({ ...pendingNow, art: img || '' })); } catch {}
      if (img) { $('art').src = img; $('art').onload = () => { palette = extractPalette($('art')); const st = document.body.style; st.setProperty('--glow', `rgba(${palette[0]},.55)`); st.setProperty('--c1', `rgb(${palette[0]})`); st.setProperty('--c2', `rgb(${palette[1]})`); }; }
      loadQueue();
    }
    setPP();
    if (++pollCount % 3 === 0) loadQueue();
  } catch (e) { msg('Bağlantı hatası'); }
}
// Spotify'da çalan bir şey yokken (204) son çalan şarkıyı göster — disk boş/yeşil kalmasın
function restoreLast() {
  let L = null; try { L = JSON.parse(localStorage.getItem('lastTrack') || 'null'); } catch {}
  if (!L || !L.art) return;
  track = 'last'; duration = 1; progressBase = 0; progressAt = performance.now();
  $('art').src = L.art; $('title').textContent = L.name || ''; $('artist').textContent = L.artist || ''; if (L.img) $('npimg').src = L.img;
  $('left').hidden = false;
}
let pollCount = 0, context = null, queueItems = [], resetArc = false, shift = 0, pendingNow = null;

// ---------- Player controls & queue ----------
async function api(method, path, body) {
  const t = await getToken(); if (!t) return null;
  const r = await fetch('https://api.spotify.com/v1/me/player' + path, { method,
    headers: { Authorization: 'Bearer ' + t, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  if (r.status === 403) msg('Kontrol için Spotify Premium gerekiyor.');
  else if (r.status === 404) msg('Aktif Spotify cihazı yok — önce Spotify\'da bir şey çal.');
  return r;
}
const refreshSoon = () => setTimeout(poll, 400);
// ---------- ses: kaydırıcı + sessiz ----------
const VOL_ON = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';
const VOL_OFF = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>';
let vol = 50, volPrev = 50, volLock = 0, volT = null;
function showVol(v) { vol = v; $('volr').value = v; $('volr').style.setProperty('--vp', v + '%'); $('volv').textContent = v; $('mute').innerHTML = v ? VOL_ON : VOL_OFF; }
function setVol(v) {
  v = Math.max(0, Math.min(100, Math.round(v))); showVol(v); volLock = performance.now() + 2500;
  clearTimeout(volT); volT = setTimeout(() => api('PUT', '/volume?volume_percent=' + v), 120);
}
$('volr').oninput = () => setVol(+$('volr').value);
$('volr').addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); setVol(vol - Math.sign(e.deltaY) * 5); }, { passive: false });
$('mute').onclick = () => { if (vol) { volPrev = vol; setVol(0); } else setVol(volPrev || 50); };
async function readVol() {
  if (performance.now() < volLock) return;
  const t = await getToken(); if (!t) return;
  try { const r = await fetch('https://api.spotify.com/v1/me/player', { headers: { Authorization: 'Bearer ' + t } });
    if (r.status === 200) { const j = await r.json(); const v = j.device?.volume_percent; if (typeof v === 'number' && performance.now() >= volLock) showVol(v);
      if (performance.now() >= togLock) showTog(j.shuffle_state, j.repeat_state); } } catch {}
}
// dikey bar: ses butonu / bar üstündeyken açık, ayrılınca kısa gecikmeyle kapanır
{ let vt = null; const open = () => { clearTimeout(vt); document.body.classList.add('volopen'); }, close = () => { clearTimeout(vt); vt = setTimeout(() => document.body.classList.remove('volopen'), 450); };
  for (const el of [$('mute'), $('volpop')]) { el.addEventListener('pointerenter', open); el.addEventListener('pointerleave', close); } }
// karıştır / tekrarla (off → context → track → off)
let shuf = false, rep = 'off', togLock = 0;
function showTog(s, r) { shuf = !!s; rep = r || 'off'; $('shuf').classList.toggle('on', shuf); $('rep').classList.toggle('on', rep !== 'off'); $('rep').classList.toggle('track', rep === 'track'); }
$('shuf').onclick = () => { showTog(!shuf, rep); togLock = performance.now() + 3000; api('PUT', '/shuffle?state=' + shuf); };
$('rep').onclick = () => { const n = { off: 'context', context: 'track', track: 'off' }[rep]; showTog(shuf, n); togLock = performance.now() + 3000; api('PUT', '/repeat?state=' + n); };
showVol(50); setTimeout(readVol, 1500); setInterval(readVol, 5000);
// ilk 5 saniyedeyse önceki şarkı, değilse şarkının başına sar
$('prev').onclick = async () => {
  if (curPos() > 5000) await seekTo(0); else { await api('POST', '/previous'); refreshSoon(); }
};

// ---------- Seek bar ----------
let dragging = false, seekLock = 0;
const curPos = () => Math.min(duration, playing ? progressBase + (performance.now() - progressAt) : progressBase);
async function seekTo(ms) {
  ms = Math.max(0, Math.min(duration - 1000, Math.round(ms)));
  progressBase = ms; progressAt = performance.now(); seekLock = performance.now() + 1500;
  await api('PUT', '/seek?position_ms=' + ms);
}
const barPos = e => { const r = $('bar').getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration; };
$('bar').addEventListener('pointerdown', e => { dragging = true; $('bar').classList.add('drag'); $('bar').setPointerCapture(e.pointerId); progressBase = barPos(e); progressAt = performance.now(); });
$('bar').addEventListener('pointermove', e => { if (dragging) { progressBase = barPos(e); progressAt = performance.now(); } });
$('bar').addEventListener('pointerup', e => { if (!dragging) return; dragging = false; $('bar').classList.remove('drag'); seekTo(barPos(e)); });
$('next').onclick = async () => { await api('POST', '/next'); refreshSoon(); };
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
let ppState = null;
function setPP() { if (ppState !== playing) { ppState = playing; $('pp').innerHTML = playing ? ICON_PAUSE : ICON_PLAY; } }
$('pp').onclick = async () => { await api('PUT', playing ? '/pause' : '/play'); playing = !playing; setPP(); refreshSoon(); };
// diske tıkla → oynatıcıyı aç/kapat (tercih hatırlanır)
const setOpen = o => {
  // disk ekranın üstüne yakınsa oynatıcı diskin altında açılsın
  if (o && WIDGET) { const top = screenY + $('disc').getBoundingClientRect().top - (screen.availTop || 0); document.body.classList.toggle('pbelow', top < 150); }
  $('left').classList.toggle('open', o); try { localStorage.setItem('playerOpen', o ? '1' : ''); } catch {} };
// widget modunda: diske tıkla → sadece plak simgesine küçül (mini'ye tıklayınca büyür)
if (!WIDGET) $('disc').onclick = () => setOpen(!$('left').classList.contains('open'));
// widget: disk / mini → basılı tutup çek = taşı (main imleci izler), kımıldamadan bırak = küçült/büyüt
if (WIDGET) for (const id of ['disc', 'mini']) {
  const el = $(id); let st = null;
  el.addEventListener('pointerdown', e => { if (e.button) return; e.preventDefault(); getSelection()?.removeAllRanges(); st = 1; el.setPointerCapture(e.pointerId); window.widget.dragStart(); });
  // bırakma: pencere düzeyinde dinle (yakalama kaybolsa bile)
  const end = async () => { if (!st) return; st = null; const moved = await window.widget.dragEnd(); if (moved) fitIn(50); if (!moved) setMini(!document.body.classList.contains('mini')); };
  addEventListener('pointerup', end); el.addEventListener('lostpointercapture', end);
  addEventListener('pointermove', e => { if (st && e.buttons === 0) end(); });   // bırakma kaçarsa güvenlik ağı
}

// ---------- Ayarlar (tepsi → sağ tık) ----------
let smoothK = .12, backK = .04, returning = false, backDelayMs = 3000, justDragged = false;
function applySettings(c) {
  if (!c) return;
  const st = document.documentElement.style;
  if (WIDGET && c.discSize) document.body.style.setProperty('--D', c.discSize + 'px');   // body.widget CSS'teki 240px'i ezsin
  st.setProperty('--bgop', (c.bgOpacity ?? 90) / 100);
  st.setProperty('--glowop', (c.glow ?? 100) / 100);
  st.setProperty('--wop', (c.opacity ?? 100) / 100);
  if (!WIDGET) {   // visualizer: animasyon seçimi + otomatik değiştirme (ayarlardan)
    if (c.vizMode && c.vizMode !== mode && MODES[c.vizMode]) setMode(c.vizMode);
    clearInterval(window._vizCyc);
    if (c.vizCycle > 0) window._vizCyc = setInterval(() => setMode(MODE_NAMES[(MODE_NAMES.indexOf(mode) + 1) % MODE_NAMES.length]), c.vizCycle * 1000);
  }
  st.setProperty('--soft', (c.edgeSoft ?? 6) + 'px');
  document.body.classList.toggle('nospin', c.spin === false);
  smoothK = (c.smooth ?? 12) / 100;
  backK = (c.backSpeed ?? 4) / 100;
  backDelayMs = (c.backDelay ?? 3) * 1000;
}
window.widget?.getSettings?.().then(applySettings);
window.widget?.onSettings?.(applySettings);
window.widget?.onClosePlayer?.(() => setOpen(false));   // dock'a geri girerken oynatıcı kapansın
window.widget?.onDocked?.((d, clip, shift) => {
  const b = document.body;
  if (!d) { b.classList.add('noanim'); }   // dock'tan çıkışta içerik zıplamasın (pencere aynı anda kayıyor)
  b.style.setProperty('--dshift', (shift || 0) + 'px'); b.classList.toggle('docked', d); b.style.clipPath = clip ? `inset(0 0 0 ${clip}px)` : '';
  if (!d) { void b.offsetWidth; requestAnimationFrame(() => b.classList.remove('noanim')); }
});
const setFlip = on => { const b = document.body; b.classList.add('noanim'); b.classList.toggle('flipR', !!on); void b.offsetWidth; requestAnimationFrame(() => b.classList.remove('noanim')); };
window.widget?.getSettings?.().then(c => setFlip(c.flipR));
window.widget?.onFlipOut?.(() => document.body.classList.add('flipping'));
window.widget?.onFlip?.(on => { setFlip(on); requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('flipping'))); fitIn(400); });   // sağa geçince ayna düzen
window.widget?.onPeek?.(on => document.body.classList.toggle('dpeek', on));
window.widget?.onFade?.((on, instant) => { if (instant) { B.classList.add('noanim'); B.classList.add('faded'); void B.offsetWidth; B.classList.remove('noanim'); } else B.classList.toggle('faded', !on); });

// Widget'ı taşıma: #grip tutamacı (-webkit-app-region: drag) — Windows'un kendi pencere sürüklemesi
try { if (localStorage.getItem('playerOpen')) $('left').classList.add('open'); } catch {}

let skipping = false, jumpId = null, jumpUntil = 0;
async function loadQueue() {
  if (skipping) return;
  const r = await api('GET', '/queue'); if (!r || !r.ok) return;
  const jq = await r.json();
  // seçilen şarkıya geçiş sürerken eski listeyi gösterme
  if (jumpId && performance.now() < jumpUntil && jq.currently_playing?.id !== jumpId) { setTimeout(loadQueue, 600); return; }
  jumpId = null;
  // sıra listesi ile 'şimdi çalan' bilgisi senkron değilse (şarkı geçişi sırasında) listeyi yeniden kurma → zıplama olmaz
  if (jq.currently_playing && jq.currently_playing.id !== track) { if (shift || pendingNow) setTimeout(loadQueue, 600); return; }
  renderQueue(jq.queue || []);
}
// listeyi kur; her satır, aynı şarkının ekrandaki eski konumundan yeni yerine kayar
let nowChanged = false;
function renderQueue(q) {
  nowChanged = false;
  queueItems = q;
  const list = $('queue');
  // her şarkının ekrandaki mevcut konumunu hatırla (id → görsel sıra), yeni listede oradan kaysın
  const seen = new Map();
  [...list.children].forEach((c, idx) => { const id = c.dataset.id; if (id && !seen.has(id)) seen.set(id, idx + (c._off || 0) - arcPos); });
  while (list.children.length > 1) list.lastChild.remove();
  q.slice(0, 20).forEach((it, i) => {
    const li = document.createElement('li');
    const img = document.createElement('img'); img.src = it.album?.images?.at(-1)?.url || ''; img.alt = '';
    const d = document.createElement('div');
    const n = document.createElement('b'); n.textContent = it.name;
    const a = document.createElement('span'); a.textContent = (it.artists || []).map(x => x.name).join(', ') || it.show?.name || '';
    d.append(n, a); li.append(img, d);
    li.onclick = () => jumpTo(i, li);
    li.dataset.id = it.id || it.uri;
    list.append(li);
  });
  if (pendingNow) {   // şimdi çalıyor satırını liste ile aynı anda güncelle
    const now = $('nowitem');
    nowChanged = !!now.dataset.id && now.dataset.id !== track;
    if (nowChanged) {   // eski 'şimdi çalıyor' yukarı kayıp kaybolsun
      const g = now.cloneNode(true); g.removeAttribute('id'); g.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
      g.dataset.id = ''; g.classList.add('ghost'); g.style.transition = 'transform .35s ease-out, opacity .25s ease-out'; list.append(g);
      requestAnimationFrame(() => { g.style.opacity = 0; g.style.transform += ' translateY(-30px)'; });
      setTimeout(() => g.remove(), 400);
    }
    $('title').textContent = pendingNow.name; $('artist').textContent = pendingNow.artist; $('npimg').src = pendingNow.img; pendingNow = null;
  }
  $('nowitem').dataset.id = track;
  // şarkı değiştiyse liste başa döner; her satır eski konumundan yenisine yumuşakça kayar
  if (shift || resetArc) { arcPos = arcTarget = 0; shift = 0; resetArc = false; }
  [...list.children].forEach((c, j) => {
    const old = seen.get(c.dataset.id);
    const raw = old !== undefined ? old - (j - arcPos) : null;
    if (old !== undefined) seen.delete(c.dataset.id);
    if (j === 0 && nowChanged && raw !== null && Math.abs(raw) < 1.2) c._off = raw;   // zaten üste kaymış: olduğu yerde kalsın
    else if (j === 0 && nowChanged) { c._off = .6; c._fade = 0; }
    else if (raw !== null && raw < -.5) { c._off = .8; c._fade = 0; }   // yukarıdan çıkmıştı ama Spotify listede tuttu: alttan belirsin            // yeni 'şimdi çalıyor': hafif alttan belirerek gelsin
    else if (raw === null) { c._off = .8; c._fade = 0; }                // listeye yeni giren: alttan belirsin
    else if (Math.abs(raw) > 1.2) { c._off = Math.sign(raw) * .8; c._fade = 0; }   // uzaktan gelen: satırların üstünden geçmesin, belirsin
    else c._off = raw;                                                  // yakın: yumuşakça kaysın
  });
}

// ---------- Kavisli liste: diskin etrafına sarılır, tekerlek/sürükle ile kayar ----------
let arcPos = 0, arcTarget = 0, arcMoved = false;
const STEP = 0.33;            // öğeler arası açı (radyan)
const PETAL = .45;            // satırların çember yönünde eğilme oranı (0 = düz)
let START = -1.0, startT = -1.0;   // ilk öğenin açısı (sağ üst); disk ekranın tepesindeyse liste aşağı doğru açılır
if (WIDGET) setInterval(() => { const d = $('disc'); if (!d) return; const top = screenY + d.getBoundingClientRect().top - (screen.availTop || 0); startT = top < 150 ? -0.15 : -1.0; }, 400);
function layoutArc() {
  const items = [...$('queue').children].filter(e => !e.classList.contains('ghost')), n = items.length;
  arcTarget = Math.max(0, Math.min(n - 1, arcTarget));
  START += (startT - START) * .08;
  arcPos += (arcTarget - arcPos) * (returning ? backK : smoothK);
  if (returning && Math.abs(arcPos) < .005) returning = false;
  const D = $('disc').offsetWidth, R = D / 2 + 26;
  // liste yakalama alanında diskin şeklinde delik: disk tamamen tıklanabilir/sürüklenebilir kalsın
  const hit = $('arcHit'), hw = hit.offsetWidth, hh = hit.offsetHeight;
  if (hit._k !== D + 'x' + hw + 'x' + hh && hw) {
    hit._k = D + 'x' + hw + 'x' + hh;
    const r = D / 2 + 2, cx = D / 2 - hit.offsetLeft, cy = $('disc').offsetTop - hit.offsetTop + D / 2;
    hit.style.clipPath = `path(evenodd, "M0 0H${hw}V${hh}H0Z M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z")`;
  }
  for (let i = 0; i < n; i++) {
    const el = items[i];
    el._off = Math.abs(el._off || 0) < .001 ? 0 : el._off * .93;   // liste yenilenince eski konumdan kayma
    const pos = i + el._off - arcPos;
    const th = START + pos * STEP + .17 * Math.max(0, Math.min(1, pos));   // büyük 'şimdi çalıyor' satırının altında ek boşluk
    // görünür pencere: üstte -1.3, altta +1.5 radyanda kaybolur
    const fade = th < START ? 1 - (START - th) / .35 : th > START + 1.75 ? 1 - (th - START - 1.75) / .5 : 1;
    const op = Math.max(0, Math.min(1, fade));
    const w = Math.max(0, 1 - Math.abs(i + el._off - arcPos));   // en üst konuma yakınlık → büyüme + etiket
    el._fade = Math.min(1, (el._fade ?? 1) + .05);
    el.style.opacity = op * el._fade;
    el.style.setProperty('--w', w.toFixed(3));
    // 'ŞİMDİ ÇALIYOR' etiketi sadece gerçekten çalan şarkıda (veya tıklanıp geçilmekte olan şarkıda)
    const isNow = el.id === 'nowitem' || (jumpId && el.dataset.id === jumpId && performance.now() < jumpUntil);
    el.style.setProperty('--lab', isNow ? w.toFixed(3) : 0);
    const Ri = R + 16 * Math.min(1, Math.abs(el._off));   // yer değiştiren satır diğerlerinin dışından geçsin
    el.style.transform = `translate(${D / 2 + Math.cos(th) * Ri}px, ${D / 2 + Math.sin(th) * Ri}px) translateY(-50%) rotate(${th * PETAL}rad) scale(${(.85 + .15 * op) * (1 + .27 * w)})`;   // çiçek yaprağı gibi dışa doğru eğik
  }
}
// Liste üstünde görünmez bir yakalama alanı: boşluklarda da tekerlek/sürükle çalışır
{
  const hit = $('arcHit');
  const liAt = (x, y) => [...$('queue').children].find(el => {
    if (+el.style.opacity <= .3 || el.classList.contains('ghost')) return false;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  // kaydırmayı bıraktıktan 3 sn sonra yumuşakça başa (şimdi çalıyor) dön; yeni kaydırma süreyi sıfırlar
  let backT = 0;
  const scheduleBack = () => { clearTimeout(backT); returning = false; if (backDelayMs > 0) backT = setTimeout(() => { arcTarget = 0; returning = true; }, backDelayMs); };
  const cancelBack = () => { clearTimeout(backT); returning = false; };
  let acc = 0;
  hit.addEventListener('wheel', e => {
    e.preventDefault();
    scheduleBack();
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (Math.abs(d) >= 40) { arcTarget = Math.round(arcTarget) + Math.sign(d); acc = 0; return; }  // fare tekerleği: tık başına 1 şarkı
    acc += d;                                                                                     // touchpad: biriktir
    if (Math.abs(acc) >= 60) { arcTarget = Math.round(arcTarget) + Math.sign(acc); acc = 0; }
  }, { passive: false });
  let y0 = null, t0 = 0, hov = null, btn = 0;   // sol tık = sadece seçim; basılı sürükleyerek kaydırma yalnızca orta tuşla
  const onDisc = (x, y) => { const r = $('disc').getBoundingClientRect(); return Math.hypot(x - r.left - r.width / 2, y - r.top - r.height / 2) <= r.width / 2; };
  hit.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });   // orta tuş otomatik kaydırma ikonu çıkmasın
  hit.addEventListener('pointerdown', e => { if (e.button > 1) return; btn = e.button; cancelBack(); y0 = e.clientY; t0 = arcTarget; arcMoved = false; hit.setPointerCapture(e.pointerId); });
  hit.addEventListener('pointermove', e => {
    if (y0 !== null) {
      const dy = e.clientY - y0; if (btn === 1 && Math.abs(dy) > 6) arcMoved = true;
      if (arcMoved) arcTarget = t0 - dy / 50;
    }
    const li = arcMoved ? null : liAt(e.clientX, e.clientY);
    if (li !== hov) { hov?.classList.remove('hover'); li?.classList.add('hover'); hov = li; }
    hit.style.cursor = y0 !== null && arcMoved ? 'grabbing' : (li && li.id !== 'nowitem') || (!li && onDisc(e.clientX, e.clientY)) ? 'pointer' : 'default';
  });
  const end = e => {
    if (y0 === null) return; y0 = null;
    arcTarget = Math.round(arcTarget);
    if (arcMoved) scheduleBack();
    if (!arcMoved && btn === 0) {
      const li = liAt(e.clientX, e.clientY);
      if (li && li.onclick) li.onclick();
      else if (onDisc(e.clientX, e.clientY) && $('disc').onclick) $('disc').onclick();   // diskin sağ yarısı bu alanın altında kalıyor
    }
    arcMoved = false;
  };
  hit.addEventListener('pointerup', end);
  hit.addEventListener('pointercancel', () => { scheduleBack(); y0 = null; arcMoved = false; arcTarget = Math.round(arcTarget); });
  hit.addEventListener('pointerleave', () => { hov?.classList.remove('hover'); hov = null; });
}
// Spotify'da "kuyruktaki şarkıya atla" yok: hedefe kadar next'e basıyoruz (bağlam korunur)
// Seçilen şarkıya tek seferde atla:
// 1) Playlist/albümden çalıyorsa: aynı bağlamı o şarkıdan başlat (bağlam ve sıra korunur)
// 2) Olmazsa: sıradaki listeyi o şarkıdan itibaren çal
async function jumpTo(i, li) {
  if (skipping) return; skipping = true; li.classList.add('busy');
  const target = queueItems[i];
  // hemen ekranda uygula: sadece seçilen şarkı en üste çıkar, diğerleri yerinde kalır
  if (target) {
    pendingNow = { name: target.name, artist: (target.artists || []).map(x => x.name).join(', '), img: target.album?.images?.at(-1)?.url || '' };
    jumpId = target.id; jumpUntil = performance.now() + 6000;
    const big = target.album?.images?.[0]?.url; if (big) $('art').src = big;   // disk kapağı da hemen değişsin
    arcTarget = i + 1;   // tüm liste tekerlek gibi kayar, seçilen şarkı en üste gelir
  }
  try {
    // 'ileri'ye i+1 kez bas: aradaki şarkılar Spotify'ın sırasından da gerçekten düşer (liste ile birebir aynı olur)
    for (let k = 0; k <= i; k++) {
      const r = await api('POST', '/next');
      if (!r || !r.ok) return;   // aktif cihaz yok / hata
    }
  } finally { skipping = false; refreshSoon(); setTimeout(loadQueue, 900); }
}
function extractPalette(img) {
  // baskın renk: tek en canlı piksel değil, kapağın büyük kısmını kaplayan ton (ağırlıklı ton histogramı)
  const N = 48, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data, bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let all = [0, 0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255, s = mx ? (mx - mn) / mx : 0;
    all[0] += r; all[1] += g; all[2] += b; all[3]++;
    if (s < .22 || v < .18) continue;                       // gri / çok karanlık pikseller renk belirlemesin
    let h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn);
    h = ((h * 60) + 360) % 360;
    const w = Math.sqrt(s) * v, k = bins[Math.floor(h / 15) % 24];   // alan ağırlıklı (yaygın renk kazanır)
    k.w += w; k.r += r * w; k.g += g * w; k.b += b * w;
  }
  // komşu kutuları birleştirerek tepe tonları bul
  const sc = bins.map((k, i) => ({ i, w: k.w + .5 * (bins[(i + 23) % 24].w + bins[(i + 1) % 24].w) })).sort((a, b) => b.w - a.w);
  const out = [];
  for (const p of sc) {
    if (p.w <= 0) break;
    if (out.some(o => Math.min(Math.abs(o.i - p.i), 24 - Math.abs(o.i - p.i)) < 3)) continue;
    const ks = [bins[(p.i + 23) % 24], bins[p.i], bins[(p.i + 1) % 24]], W = ks.reduce((a, k) => a + k.w, 0);
    let col = ['r', 'g', 'b'].map(ch => ks.reduce((a, k) => a + k[ch], 0) / W);
    const m = Math.max(...col); if (m < 170) col = col.map(v => v * 170 / m);   // glow için biraz parlat
    out.push({ i: p.i, c: col.map(v => Math.min(255, Math.round(v))) });
    if (out.length === 3) break;
  }
  const res = out.map(o => o.c);
  if (!res.length) { const a = all.slice(0, 3).map(v => Math.round(v / all[3])); res.push(a); }
  while (res.length < 3) res.push(res[res.length - 1]);
  return res;
}

// ---------- Audio capture ----------
let analyser = null, freq = new Uint8Array(1024);
async function captureAudio() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (!stream.getAudioTracks().length) { stream.getTracks().forEach(t => t.stop()); throw new Error('no audio'); }
    stream.getVideoTracks().forEach(t => t.stop());
  } catch {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); msg('Sistem sesi alınamadı, mikrofon kullanılıyor.'); }
    catch { return msg('Ses alınamadı — ambient modda devam.'); }
  }
  const ctx = new AudioContext();
  analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8;
  ctx.createMediaStreamSource(stream).connect(analyser);
  freq = new Uint8Array(analyser.frequencyBinCount);
  $('audio').hidden = true;
}

// ---------- Visuals ----------
const cv = $('c'), g = cv.getContext('2d');
let W, H; const resize = () => { W = cv.width = innerWidth * devicePixelRatio; H = cv.height = innerHeight * devicePixelRatio; };
addEventListener('resize', resize); resize();
const rgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
let sb = 0, sm = 0, st = 0, rot = 0;
const particles = Array.from({ length: 220 }, () => ({ a: Math.random() * 6.28, r: Math.random(), s: .2 + Math.random(), z: Math.random() }));
const wave = new Uint8Array(2048);

function bands(t) {
  if (analyser) {
    analyser.getByteFrequencyData(freq);
    const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += freq[i]; return s / (b - a) / 255; };
    return [avg(1, 8), avg(8, 80), avg(80, 400)];
  }
  const k = playing ? 1 : .3; // ambient fallback
  return [k*(.4+.3*Math.sin(t*4)**8), k*(.3+.2*Math.sin(t*1.3)), k*(.2+.15*Math.sin(t*2.7))];
}
// i: 0..1 → 0..1 band değeri (log ölçek), ses yoksa sahte
function bin(x, t) {
  if (analyser) return freq[Math.floor(2 + Math.pow(x, 2) * 500)] / 255;
  return sm * (.5 + .5 * Math.sin(x * 20 + t * 3)) * (1 - x * .5);
}

const MODES = {
  'Halka'(t, [c1, c2, c3], cx, cy, R) {
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, R * (.4 + sb * .4));
    grd.addColorStop(0, rgb(c1, .35 + sb * .4)); grd.addColorStop(.5, rgb(c2, .15)); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    const N = 128, base = R * (.16 + sb * .06);
    g.save(); g.translate(cx, cy); g.rotate(rot); g.lineCap = 'round';
    for (let i = 0; i < N; i++) {
      const v = bin(i < N/2 ? i / (N/2) : (N - i) / (N/2), t), a = i / N * Math.PI * 2, len = base * .15 + v * R * .22;
      g.strokeStyle = rgb(i % 2 ? c2 : c3, .9); g.lineWidth = R * .006;
      g.beginPath(); g.moveTo(Math.cos(a) * base, Math.sin(a) * base);
      g.lineTo(Math.cos(a) * (base + len), Math.sin(a) * (base + len)); g.stroke();
    }
    g.restore();
    g.beginPath(); g.arc(cx, cy, base * (.9 + sb * .15), 0, 6.28); g.fillStyle = rgb(c1, .9); g.fill();
    for (const p of particles) {
      p.r += .002 * p.s * (1 + st * 8); if (p.r > 1) { p.r = 0; p.a = Math.random() * 6.28; }
      const d = base + p.r * R * .7;
      g.fillStyle = rgb(c3, (1 - p.r) * .8);
      g.beginPath(); g.arc(cx + Math.cos(p.a + rot) * d, cy + Math.sin(p.a + rot) * d, R * .003 * (1 + st * 3), 0, 6.28); g.fill();
    }
  },
  'Spektrum'(t, [c1, c2, c3]) {
    const N = 64, bw = W / N, grd = g.createLinearGradient(0, H, 0, H * .2);
    grd.addColorStop(0, rgb(c1, 1)); grd.addColorStop(.6, rgb(c2, 1)); grd.addColorStop(1, rgb(c3, 1));
    g.fillStyle = grd;
    for (let i = 0; i < N; i++) {
      const v = bin(i / N, t), h = v * H * .75 + 4;
      g.fillRect(i * bw + bw * .15, H - h, bw * .7, h);
      g.globalAlpha = .25; g.fillRect(i * bw + bw * .15, H, bw * .7, -h * .02 - 2); g.globalAlpha = 1;
    }
  },
  'Dalga'(t, [c1, c2, c3], cx, cy) {
    let data = null;
    if (analyser) { analyser.getByteTimeDomainData(wave); data = wave; }
    const lines = [[c1, 1, 0], [c2, .7, .6], [c3, .5, 1.2]];
    g.lineWidth = 3 * devicePixelRatio; g.shadowBlur = 20 * devicePixelRatio;
    for (const [c, amp, ph] of lines) {
      g.strokeStyle = rgb(c, .9); g.shadowColor = rgb(c, 1); g.beginPath();
      for (let x = 0; x <= W; x += 6) {
        const u = x / W;
        const v = data ? (data[Math.floor(u * 1023 + ph * 100) % 2048] - 128) / 128
                       : Math.sin(u * 12 + t * 2 + ph) * (.3 + sb) * Math.sin(u * Math.PI);
        const y = cy + v * H * .35 * amp * (1 + sb);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    g.shadowBlur = 0;
  },
  'Galaksi'(t, [c1, c2, c3], cx, cy, R) {
    for (const p of particles) {
      p.z -= .004 * (1 + sb * 6) * p.s; if (p.z <= .02) { p.z = 1; p.a = Math.random() * 6.28; p.r = Math.random(); }
      const d = (p.r * R * .6 + R * .05) / p.z, a = p.a + rot * (1 + p.r);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, s = (1 - p.z) * R * .008 * (1 + st * 2);
      g.fillStyle = rgb([c1, c2, c3][Math.floor(p.r * 3)], 1 - p.z * .7);
      g.beginPath(); g.arc(x, y, s, 0, 6.28); g.fill();
    }
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, R * (.12 + sb * .15));
    grd.addColorStop(0, rgb([255,255,255], .8)); grd.addColorStop(.3, rgb(c1, .6)); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  },
};
const MODE_NAMES = Object.keys(MODES);
let mode = (() => { try { return localStorage.getItem('mode'); } catch { return null; } })();
if (!MODES[mode]) mode = MODE_NAMES[0];
function setMode(m) {
  mode = m; try { localStorage.setItem('mode', m); } catch {}
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.textContent === m));
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
}
MODE_NAMES.forEach((m, i) => {
  const b = document.createElement('button'); b.textContent = m; b.title = `Kısayol: ${i + 1}`;
  b.onclick = () => setMode(m); $('modes').append(b);
});
addEventListener('keydown', e => { const i = +e.key - 1; if (MODE_NAMES[i]) setMode(MODE_NAMES[i]); });
setMode(mode);

function frame(now) {
  const t = now / 1000, [b, m, tr] = bands(t);
  sb += (b - sb) * .3; sm += (m - sm) * .15; st += (tr - st) * .2;
  rot += .002 + sm * .01;
  if (!WIDGET) {
    g.fillStyle = mode === 'Spektrum' ? 'rgba(0,0,0,.35)' : 'rgba(0,0,0,.18)'; g.fillRect(0, 0, W, H);
    MODES[mode](t, palette, W / 2, H / 2, Math.min(W, H));
  }
  layoutArc();
  if (WIDGET) B.classList.toggle('nolog', $('left').hidden);
  if (track) {
    const prog = dragging ? progressBase : curPos();
    $('prog').style.width = Math.min(100, prog / duration * 100) + '%';
    $('cur').textContent = fmt(prog); $('dur').textContent = fmt(duration);
    $('art').classList.toggle('on', playing); $('miniimg').classList.toggle('on', playing);
    if ($('miniimg').src !== $('art').src) $('miniimg').src = $('art').src;
  }
  requestAnimationFrame(frame);
}

const fmt = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ---------- Widget: boş alanlara tıklama masaüstüne geçsin ----------
// Küçük mod: sol altta mini plak. Üstüne gelince geçici açılır (peek), tıklayınca sabit açılır.
const B = document.body;
// görünen kısım ekran dışına taştıysa pencereyi yumuşakça ekranın içine al
function fitIn(delay = 480) {
  setTimeout(() => {
    const els = B.classList.contains('mini') ? [$('mini')] : [$('stage'), $('left').classList.contains('open') ? $('player') : null];   // kapalı oynatıcı için üstte boşluk bırakma
    let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
    for (const el of els) { if (!el || !el.offsetParent && el.id !== 'mini') continue; const q = el.getBoundingClientRect(); if (!q.width) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
    const dq = $('disc').getBoundingClientRect(), mini = B.classList.contains('mini');
    if (r > l) window.widget?.fit?.([l, t, r, b, mini ? 0 : dq.left, mini ? 0 : dq.width].map(Math.round));
  }, delay);
}
const setMini = m => { setTimeout(() => fitIn(), 0); B.classList.toggle('mini', m); B.classList.remove('peek'); try { localStorage.setItem('mini', m ? '1' : ''); } catch {} };
if (WIDGET) {
  try { if (localStorage.getItem('mini')) B.classList.add('mini'); } catch {}
  fitIn(2500);   // açılışta da ekran dışındaysa içeri al
  // tam modda: küçült · peek modunda (📌): sabit açık bırak
  window.widget?.onToggleMini?.(() => setMini(!B.classList.contains('mini')));   // diske/mini'ye tıklama (main algılar)
  $('minBtn').onclick = e => { e.stopPropagation(); setOpen(!$('left').classList.contains('open')); };   // ok: oynatıcıyı yukarıda aç/kapat
  // geçici açıkken (peek) panelde herhangi bir yere tıklamak onu sabit açık bırakır
  addEventListener('pointerdown', e => { if (B.classList.contains('peek') && inside(e.clientX, e.clientY) && !e.target.closest('#minBtn')) setMini(false); }, true);
}
let peekT = 0;
function inside(x, y) {
  const els = B.classList.contains('mini') && !B.classList.contains('peek') ? [$('mini')] : [$('stage'), $('player'), $('controls'), $('mini')];
  return els.some(el => { if (!el || !el.offsetParent && el.id !== 'mini') return false; const r = el.getBoundingClientRect(); return r.width && x >= r.left - 10 && x <= r.right + 10 && y >= r.top - 10 && y <= r.bottom + 10; });
}
if (WIDGET) {
  let over = null;
  const update = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const hitUi = !!el && el.closest('#disc, #arcHit, #player, #controls button, #msg, #mini, #minBtn') !== null;
    // peek modunda: panelden çıkınca kısa süre sonra tekrar küçül
    if (B.classList.contains('peek')) {
      if (inside(x, y)) clearTimeout(peekT);
      else { clearTimeout(peekT); peekT = setTimeout(() => B.classList.remove('peek'), 500); }
    }
    // sürüklerken pencere fareyi asla bırakmasın (yoksa taşıma yarıda kesilir)
    const o = hitUi || (B.classList.contains('peek') && inside(x, y));
  };
  addEventListener('mousemove', e => update(e.clientX, e.clientY));
  // tıklanabilir alanları ana sürece bildir; o imleci kendisi izleyip tıklama-geçirmeyi açar/kapatır
  const HIT = '#disc, #arcHit, #player, #volpop, #controls button, #msg, #mini, #minBtn';
  const ALWAYS = ['minBtn'];   // görünmezken de yeri tıklanabilir (üstüne gelince belirir)
  let lastRects = '';
  setInterval(() => {
    const rects = [];
    document.querySelectorAll(HIT).forEach(el => {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || cs.display === 'none') return;
      if (+cs.opacity < .05 && !ALWAYS.includes(el.id)) return;
      if (el.closest('[hidden]')) return;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      rects.push([Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), el.id === 'disc' || el.id === 'mini' ? 1 : 0, el.id]);
    });
    const k = JSON.stringify(rects);
    if (k !== lastRects) { lastRects = k; window.widget?.setHitRects?.(rects); }
  }, 200);
  // imlecin hangi parçanın üstünde olduğunu main söyler (sürükleme alanında CSS :hover çalışmaz)
  // çıkışta kısa gecikme: diskten butona giderken arada kaybolmasın
  const hovT = {};
  const setHov = (cls, on) => { clearTimeout(hovT[cls]); if (on) B.classList.add(cls); else hovT[cls] = setTimeout(() => B.classList.remove(cls), 450); };
  window.widget?.onHover?.(id => {
    setHov('hov', ['disc', 'minBtn'].includes(id));
    setHov('hovmini', ['mini'].includes(id));
  });
  document.addEventListener('mouseleave', () => { if (B.classList.contains('peek')) { clearTimeout(peekT); peekT = setTimeout(() => B.classList.remove('peek'), 500); } });
}

// ---------- Init ----------
$('login').onclick = login;
$('audio').onclick = captureAudio;
$('fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
(async () => {
  try { await handleRedirect(); } catch (e) { msg('Giriş başarısız: ' + e.message); }
  await poll(); setInterval(poll, 3000);
  requestAnimationFrame(frame);
})();

// diske / mini'ye sağ tık → visualizer menüsü
if (WIDGET) for (const id of ['disc', 'mini']) document.getElementById(id)?.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); window.widget?.contextMenu?.(); });

// ---------- Senkron şarkı sözleri (sadece arka plan visualizer) ----------
let lyr = [], lyrIdx = -2, lyrOn = true, lyrFor = null;
if (BG) {
  const box = document.createElement('div'); box.id = 'lyrics';
  box.innerHTML = '<div class="ln prev"></div><div class="ln cur"></div><div class="ln next"></div>';
  document.body.appendChild(box);
  window.widget?.getSettings?.().then(c => { lyrOn = c.lyrics !== false; });
  window.widget?.onSettings?.(c => { lyrOn = c.lyrics !== false; });
  const tick = () => {
    const on = lyrOn && lyr.length > 0;
    box.classList.toggle('on', on);
    if (on) {
      const pos = curPos() + 250;   // küçük ön alma: satır sesle aynı anda gelsin
      let i = -1; for (let k = 0; k < lyr.length && lyr[k].t <= pos; k++) i = k;
      if (i !== lyrIdx) {
        lyrIdx = i;
        box.classList.add('step');   // eski satır aşağı kayıp söner, yenisi yükselir
        setTimeout(() => {
          const q = box.children;
          q[0].textContent = lyr[i - 1]?.s || ''; q[1].textContent = lyr[i]?.s || '♪'; q[2].textContent = lyr[i + 1]?.s || '';
          box.classList.remove('step');
        }, 180);
      }
      const a = lyr[i]?.t ?? 0, b = lyr[i + 1]?.t ?? a + 4000;   // satır içinde soldan sağa dolan vurgu
      box.children[1].style.setProperty('--k', Math.max(0, Math.min(100, (pos - a) / Math.max(1, b - a) * 115)) + '%');
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
async function loadLyrics(it) {
  lyr = []; lyrIdx = -2; const id = it.id; lyrFor = id;
  const cacheKey = 'lyr:' + id;
  try { const c = localStorage.getItem(cacheKey); if (c) { lyr = JSON.parse(c); return; } } catch {}
  const artist = it.artists?.[0]?.name || '', name = it.name || '';
  const q = new URLSearchParams({ artist_name: artist, track_name: name, album_name: it.album?.name || '', duration: Math.round((it.duration_ms || 0) / 1000) });
  let j = null;
  try { const r = await fetch('https://lrclib.net/api/get?' + q); if (r.ok) j = await r.json(); } catch {}
  if (!j?.syncedLyrics) {   // tam eşleşme yoksa aramayla dene
    try { const r = await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ track_name: name, artist_name: artist })); if (r.ok) j = (await r.json()).find(x => x.syncedLyrics) || null; } catch {}
  }
  if (lyrFor !== id || !j?.syncedLyrics) return;
  const out = [];
  for (const line of j.syncedLyrics.split(/\r?\n/)) {
    const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/); if (!m) continue;
    out.push({ t: (+m[1] * 60 + +m[2]) * 1000, s: m[3].trim() });
  }
  lyr = out;
  try { localStorage.setItem(cacheKey, JSON.stringify(out)); } catch {}
}
