const { app, BrowserWindow, session, desktopCapturer, screen, Tray, Menu, ipcMain, nativeImage } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8888;
const BASE = `http://127.0.0.1:${PORT}/`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const DEFAULTS = { alwaysOnTop: true, discSize: 240, bgOpacity: 90, spin: true, backDelay: 3, smooth: 12, backSpeed: 4, glow: 100, edgeSoft: 6, dockDelay: 1.2, opacity: 100, vizMode: 'Halka', vizCycle: 0, lyrics: true };
const widgetSize = () => ({ w: 320 + 450, h: 320 + 470 });   // altta oynatıcı için de yer var   // sabit (en büyük disk) → boyut değişince pencere zıplamaz

// tek kopya çalışsın
if (!app.requestSingleInstanceLock()) app.quit();

// ---------- ayarlar (seçilen ekran) ----------
const cfgPath = () => path.join(app.getPath('userData'), 'settings.json');
const loadCfg = () => { let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch {} return { ...DEFAULTS, ...c }; };
const saveCfg = c => fs.writeFileSync(cfgPath(), JSON.stringify(c));
let cfg = {};

// ---------- Spotify redirect URI'si için yerel sunucu ----------
function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x').pathname;
      const file = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
      if (!['index.html', 'app.js', 'config.js', 'settings.html'].includes(file)) { res.writeHead(404); return res.end(); }
      fs.readFile(path.join(__dirname, file), (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] });
        res.end(data);
      });
    });
    srv.on('error', reject);
    srv.listen(PORT, '127.0.0.1', resolve);
  });
}

// ---------- Spotify girişini ayrı, normal bir pencerede aç ----------
function hookAuth(win) {
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('https://accounts.spotify.com/')) return;
    e.preventDefault();
    const auth = new BrowserWindow({ width: 520, height: 760, title: 'Spotify girişi', autoHideMenuBar: true });
    const back = (ev, u) => {
      if (!u.startsWith(BASE)) return;
      ev.preventDefault();
      const q = new URL(u).search;                      // ?code=... veya ?error=...
      const target = new URL(win.webContents.getURL());
      win.loadURL(BASE + q + (target.searchParams.has('widget') ? '&widget' : ''));
      auth.close();
    };
    auth.webContents.on('will-redirect', back);
    auth.webContents.on('will-navigate', back);
    auth.loadURL(url);
  });
}

// ---------- Masaüstü widget'ı ----------
let widget = null, visualizer = null, tray = null;

function pickDisplay() {
  const all = screen.getAllDisplays();
  return all.find(d => d.id === cfg.displayId) || screen.getPrimaryDisplay();
}
function placeWidget() {
  if (!widget) return;
  const { w, h } = widgetSize();
  // sürüklenip bırakıldıysa o konum (sol-alt köşe) — hâlâ bir ekranın içindeyse
  if (cfg.pos) {
    const d = screen.getDisplayNearestPoint({ x: cfg.pos.x + 40, y: cfg.pos.y - 40 }).workArea;
    const x = Math.max(d.x - 20, Math.min(cfg.pos.x, d.x + d.width - 120));
    const y = Math.max(d.y + 120, Math.min(cfg.pos.y, d.y + d.height + 20));
    return widget.setBounds({ x, y: y - h, width: w, height: h });
  }
  const wa = pickDisplay().workArea;
  widget.setBounds({ x: wa.x, y: wa.y + wa.height - h, width: w, height: h });
}
function createWidget() {
  widget = new BrowserWindow({
    width: widgetSize().w, height: widgetSize().h, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000', title: 'Spotify Widget',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  placeWidget();
  widget.setAlwaysOnTop(!!cfg.alwaysOnTop, 'screen-saver');   // açılan pencerelerin önünde kalsın
  widget.setIgnoreMouseEvents(true, { forward: true });   // boş alan → masaüstüne tıklanır
  hookAuth(widget);
  widget.loadURL(BASE + '?widget');
  // tutamaçla taşınınca konumu kaydet (sol-alt köşe)
  let moveT = null;
  widget.on('moved', () => { clearTimeout(moveT); moveT = setTimeout(() => { if (!widget) return; const b = widget.getBounds(); cfg.pos = { x: b.x, y: b.y + b.height }; saveCfg(cfg); }, 200); });
  widget.on('closed', () => { widget = null; });
}

// arka plan visualizer: widget'ın ekranını kaplar, tıklamalar arkaya geçer, diğer pencereler üstüne çıkabilir
function sendToBack(win, cb) {   // pencereyi z-sırasının en altına (masaüstünün hemen üstüne) at, odak çalmadan
  try {
    const buf = win.getNativeWindowHandle();
    const h = buf.length >= 8 ? buf.readBigUInt64LE(0).toString() : String(buf.readUInt32LE(0));
    const ps = "Add-Type -Name W -Namespace N -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);'; [N.W]::SetWindowPos([IntPtr]" + h + ", [IntPtr]1, 0,0,0,0, 0x13) | Out-Null";
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, () => cb && cb());
  } catch { cb && cb(); }
}

function openVisualizer() {
  if (visualizer) {   // tekrar seçince: ters animasyonla kapat
    const v = visualizer;
    if (v._closing) return;
    v._closing = true;
    v.webContents.send('unreveal');
    setTimeout(() => { if (!v.isDestroyed()) v.close(); }, 750);
    return;
  }
  const d = widget ? screen.getDisplayMatching(widget.getBounds()) : screen.getPrimaryDisplay();
  visualizer = new BrowserWindow({ ...d.bounds, frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true,
    transparent: true, backgroundColor: '#00000000', title: 'Spotify Visualizer', show: false, webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') } });
  visualizer.setIgnoreMouseEvents(true);
  hookAuth(visualizer);
  // açılma animasyonunun merkezi: widget'taki disk
  let rx = '50%', ry = '50%';
  if (widget) { const wb = widget.getBounds(), D = cfg.discSize || 240, cx = 70 + D / 2; rx = (wb.x - d.bounds.x + (cfg.flipR ? wb.width - cx : cx)) + 'px'; ry = (wb.y - d.bounds.y + wb.height - 250 - D / 2) + 'px'; }
  visualizer.loadURL(BASE + '?bg&rx=' + encodeURIComponent(rx) + '&ry=' + encodeURIComponent(ry));
  const v = visualizer;
  v.once('ready-to-show', () => {
    v.setOpacity(0);
    v.showInactive();
    sendToBack(v, () => {   // öndeki pencerelerin arkasında kalsın
      if (v.isDestroyed()) return;
      v.setOpacity(1);
      v.webContents.send('reveal');
      widget && widget.moveTop();
    });
  });
  v.on('closed', () => { if (visualizer === v) visualizer = null; });
}

// ---------- Ayarlar penceresi (tepsi simgesine sağ tık) ----------
let settingsWin = null;
function openSettings() {
  if (settingsWin) { settingsWin.webContents.send('settings:refresh'); settingsWin.show(); settingsWin.focus(); return; }
  const W = 420, H = 680;
  const pt = screen.getCursorScreenPoint(), wa = screen.getDisplayNearestPoint(pt).workArea;
  settingsWin = new BrowserWindow({
    width: W, height: H, x: Math.min(pt.x - W / 2, wa.x + wa.width - W) | 0, y: wa.y + wa.height - H,
    frame: false, transparent: true, resizable: false, skipTaskbar: false, alwaysOnTop: false, show: false,
    backgroundColor: '#00000000', title: 'Ayarlar', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  settingsWin.loadURL(BASE + 'settings.html');
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}
function applySetting(k, v) {
  if (k === 'openAtLogin') return app.setLoginItemSettings({ openAtLogin: !!v });
  cfg[k] = v;
  if (k === 'displayId') delete cfg.pos;            // ekran seçilince o ekranın sol altına git
  saveCfg(cfg);
  if (k === 'alwaysOnTop' && widget) widget.setAlwaysOnTop(!!v, 'screen-saver');
  if (k === 'displayId') placeWidget();
  for (const w of [widget, visualizer]) w && w.webContents.send('settings:changed', cfg);
}
// göster/gizle: ikisi de yumuşak (renderer opaklığı soldurur)
let fadeT = null;
const toggleWidget = () => {
  if (!widget) return; clearTimeout(fadeT);
  if (widget.isVisible() && !widget._hiding) { widget._hiding = true; widget.webContents.send('fade', false); fadeT = setTimeout(() => { widget.hide(); widget._hiding = false; }, 280); }
  else { widget._hiding = false; widget.webContents.send('fade', false, true); widget.showInactive(); setTimeout(() => widget && widget.webContents.send('fade', true), 30); }
};

app.whenReady().then(async () => {
  cfg = loadCfg();
  if (!cfg.layout2) { if (cfg.pos) cfg.pos.y += 140; cfg.layout2 = true; saveCfg(cfg); }   // düzen 140px yukarı alındı: widget ekranda yerinde kalsın
  await startServer();

  // getDisplayMedia → seçici penceresi olmadan Windows sistem sesi (loopback)
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    callback({ video: sources[0], audio: 'loopback' });
  });

  ipcMain.handle('settings:get', () => ({ ...cfg, displayId: pickDisplay().id, openAtLogin: app.getLoginItemSettings().openAtLogin }));
  ipcMain.handle('settings:displays', () => screen.getAllDisplays().map(d => ({ id: d.id, width: d.size.width, height: d.size.height, primary: d.id === screen.getPrimaryDisplay().id })));
  ipcMain.on('settings:set', (_e, k, v) => applySetting(k, v));
  ipcMain.on('settings:action', (_e, a) => {
    if (a === 'toggleWidget') toggleWidget();
    else if (a === 'visualizer') openVisualizer();
    else if (a === 'resetPos') { delete cfg.pos; saveCfg(cfg); placeWidget(); }
    else if (a === 'logout' && widget) widget.webContents.executeJavaScript("['access_token','refresh_token','expires_at'].forEach(k=>localStorage.removeItem(k)); location.href='/?widget'");
    else if (a === 'quit') app.quit();
    else if (a === 'minSettings') { settingsWin && settingsWin.minimize(); return; }
    if (a !== 'toggleWidget' && settingsWin) settingsWin.close();
  });

  // tıklama-geçirme: imleç widget'ın dolu bir alanındaysa pencere tıklanabilir, değilse masaüstüne geçer
  let dock = null, peeking = false, peekT = null, rearm = true;   // rearm: geri girdikten sonra fare diskten bir kez çıkmadan tekrar açılmasın (titreme döngüsü)   // dock'tayken üstüne gelince dışarı kayar (her şeye erişilsin), ayrılınca geri döner
  // dock'ta pencere hiç kımıldamaz; içerik pencere içinde CSS ile kayar (titreme olmaz)
  let peekBusy = 0;
  const setPeek = on => { peekBusy = Date.now() + 320; widget && widget.webContents.send('peek', on); };
  let dragT = null, clipX = 0, clipR = 0;   // clipX: dock'ta komşu ekrana sarkan kısım (pencere içi x) görünmez + tıklanmaz
  let hitRects = [], interactive = false, hoverId = '';
  ipcMain.on('hitrects', (_e, r) => { hitRects = Array.isArray(r) ? r : []; });
  setInterval(() => {
    if (!widget || !widget.isVisible()) return;
    const p = screen.getCursorScreenPoint(), b = widget.getBounds();
      const x = p.x - b.x, y = p.y - b.y;
    // butonlar önce (diskin üstüne biniyorlar), sonra diğerleri
    const order = [...hitRects].sort((a, b) => (/Btn$/.test(b[5]) ? 1 : 0) - (/Btn$/.test(a[5]) ? 1 : 0));
    const hit = (x < clipX || (clipR && x > b.width - clipR)) ? null : order.find(([l, t, w, h, round]) => {
      if (round) { const r = w / 2; return Math.hypot(x - l - r, y - t - h / 2) <= r + 2; }
      return x >= l - 4 && x <= l + w + 4 && y >= t - 4 && y <= t + h + 4;
    });
    const on = !!hit || !!dragT, id = hit ? hit[5] : '';   // taşırken pencere fareyi bırakmasın
    if (on !== interactive) { interactive = on; widget.setIgnoreMouseEvents(!on, { forward: true }); }
    if (id !== hoverId) { hoverId = id; widget.webContents.send('hover', id); }
    if (dock && !dragT) {
      // dışarı kayma sadece disk üstündeyken başlar; açıldıktan sonra widget'ın herhangi bir yerinde durmak açık tutar
      if (id !== 'disc' && !peeking && Date.now() > peekBusy) rearm = true;
      if ((id === 'disc' && rearm) || (peeking && id)) { clearTimeout(peekT); peekT = null; if (!peeking) { peeking = true; setPeek(true); } }
      else if (peeking && !peekT) peekT = setTimeout(() => { peekT = null; if (!dock) return; peeking = false; rearm = false; widget.webContents.send('closePlayer'); setPeek(false); }, (cfg.dockDelay ?? 1.2) * 1000);
    }
  }, 30);

  // taşıma: imleci main izler (pencere kayarken renderer olayları güvenilmez)
  let dragMoved = false;
  ipcMain.on('drag:start', () => {
    if (dock && widget) {   // dock'tan çıkarken içerik yerinde kalsın: pencereyi kaydırılmış içerik kadar sola al
      if (!peeking) { const b0 = widget.getBounds(); widget.setBounds({ ...b0, x: b0.x + (cfg.flipR ? dock.shift : -dock.shift) }); }
      widget.webContents.send('peek', false); widget.webContents.send('docked', false, 0, 0);
    }
    dock = null; peeking = false; clearTimeout(peekT); peekT = null; clipX = 0; clipR = 0;
    if (!widget) return; clearInterval(dragT);
    const b = widget.getBounds(), { x: sx, y: sy } = screen.getCursorScreenPoint();
    dragMoved = false;
    dragT = setInterval(() => {
      if (!widget) return clearInterval(dragT);
      const c = screen.getCursorScreenPoint();
      if (!dragMoved && Math.hypot(c.x - sx, c.y - sy) < 5) return;   // küçük titreme = tıklama
      dragMoved = true;
      widget.setBounds({ x: b.x + c.x - sx, y: b.y + c.y - sy, width: b.width, height: b.height });
    }, 12);
  });
  ipcMain.handle('drag:end', () => {
    clearInterval(dragT); dragT = null;
    if (widget && dragMoved) { const b = widget.getBounds(); cfg.pos = { x: b.x, y: b.y + b.height }; saveCfg(cfg); }
    return dragMoved;
  });
  // fit: [l,t,r,b] pencere içi görünen alan → taşan kısmı ekrana sığdır (yumuşak kayma)
  let fitT = null, flipping = false;
  ipcMain.on('fit', (_e, [l, t, r, b, dl = 0, dw = 0]) => {
    if (!widget || dragT) return;
    const wb = widget.getBounds();
    const wa = screen.getDisplayNearestPoint(dw ? { x: wb.x + dl + dw / 2 | 0, y: wb.y + (t + b) / 2 | 0 } : { x: wb.x + (l + r) / 2 | 0, y: wb.y + (t + b) / 2 | 0 }).workArea, m = 8, SNAP = 90;
    let dx = 0, dy = 0, docked = false;
    // disk ekranın sağ yarısındaysa düzen aynalansın (liste/oynatıcı sola); disk yerinde kalsın diye pencere kaydırılır
    if (dw) {
      const want = wb.x + dl + dw / 2 > wa.x + wa.width / 2;
      if (want !== !!cfg.flipR) {
        if (flipping) return;
        flipping = true; cfg.flipR = want; saveCfg(cfg);
        dock = null; clipX = 0; clipR = 0;
        widget.webContents.send('docked', false, 0, 0);
        widget.webContents.send('flipOut');   // liste/oynatıcı önce sönsün
        setTimeout(() => {
          flipping = false; if (!widget) return;
          const b2 = widget.getBounds();
          widget.setBounds({ ...b2, x: b2.x + 2 * dl + dw - b2.width });
          widget.webContents.send('flip', want);   // karşı tarafta yeniden doğar
        }, 240);
        return;
      }
    }
    // yatay: disk sol kenara yakın/taşmışsa dock (disk ~%40'ı ekran dışında); değilse ekrana sığdır, kenara yakınsa yapıştır
    // solunda başka ekran varsa dock yapma (disk diğer ekrana sarkardı) → sadece kenara yapıştır
    const cy = wb.y + (t + b) / 2;
    const rightNeighbor = screen.getAllDisplays().some(d => d.bounds.x >= wa.x + wa.width - 2 && d.bounds.x <= wa.x + wa.width + 40 && cy >= d.bounds.y && cy <= d.bounds.y + d.bounds.height);
    const leftNeighbor = screen.getAllDisplays().some(d => d.bounds.x + d.bounds.width <= wa.x + 2 && d.bounds.x + d.bounds.width >= wa.x - 40 && cy >= d.bounds.y && cy <= d.bounds.y + d.bounds.height);
    if (dw && cfg.flipR && wb.x + dl + dw > wa.x + wa.width - SNAP) { dx = wa.x + wa.width - m - (wb.x + dl + dw); docked = true; }
    else if (dw && !cfg.flipR && wb.x + dl < wa.x + SNAP) { dx = wa.x + m - (wb.x + dl); docked = true; }   // pencere 'açık' konumda durur, içerik CSS ile içeri kayar
    else if (wb.x + l < wa.x + SNAP) dx = wa.x + m - (wb.x + l);
    else if (wb.x + r > wa.x + wa.width - SNAP) dx = wa.x + wa.width - m - (wb.x + r);
    // dikey: üst/alt kenara yakınsa köşeye yapıştır
    if (wb.y + t < wa.y + SNAP) dy = wa.y + m - (wb.y + t); else if (wb.y + b > wa.y + wa.height - SNAP) dy = wa.y + wa.height - m - (wb.y + b);
    if (Math.abs(dx) < 1) dx = 0; if (Math.abs(dy) < 1) dy = 0;
    clipX = docked && !cfg.flipR && leftNeighbor ? Math.max(0, wa.x - (wb.x + dx)) : 0;
    clipR = docked && cfg.flipR && rightNeighbor ? Math.max(0, wb.x + dx + wb.width - (wa.x + wa.width)) : 0;   // solda ekran varsa taşan kısmı kes
    const shift = Math.round(dw * .4 + m);
    dock = docked ? { wa, nb: leftNeighbor, shift } : null; peeking = false;
    widget.webContents.send('peek', false);
    widget.webContents.send('docked', docked, Math.round(clipX || clipR), shift);
    if (!dx && !dy) return;
    clearInterval(fitT); const t0 = Date.now(), D = 320;
    fitT = setInterval(() => {
      if (!widget) return clearInterval(fitT);
      const k = Math.min(1, (Date.now() - t0) / D), e = 1 - Math.pow(1 - k, 3);
      const nx = Math.round(wb.x + dx * e);
      widget.setBounds({ x: nx, y: Math.round(wb.y + dy * e), width: wb.width, height: wb.height });
      if (k === 1) { clearInterval(fitT); cfg.pos = { x: wb.x + dx, y: wb.y + dy + wb.height }; saveCfg(cfg); }
    }, 12);
  });
  // diske sağ tık: hızlı menü
  ipcMain.on('ctxmenu', () => {
    if (!widget) return;
    Menu.buildFromTemplate([
      { label: visualizer ? "Visualizer'ı kapat" : "Visualizer'ı aç", click: openVisualizer },
      { label: 'Ayarlar', click: openSettings },
    ]).popup({ window: widget });
  });
  ipcMain.on('interactive', (e, on) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.setIgnoreMouseEvents(!on, { forward: true });
  });

  createWidget();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')));
  tray.setToolTip('Spotify Widget');
  // tek tık: widget'ı göster/gizle · çift tık: ayarlar · sağ tık: menü
  let clickT = null;
  // Windows çift tıkta sıra: click, double-click, (bazen) click → çift tıktan hemen sonraki tıklar yok sayılır
  let dblAt = 0;
  tray.on('click', () => { clearTimeout(clickT); if (Date.now() - dblAt < 600) return; clickT = setTimeout(() => { if (Date.now() - dblAt > 600) toggleWidget(); }, 350); });
  tray.on('double-click', () => { clearTimeout(clickT); dblAt = Date.now(); openSettings(); if (widget && !widget.isVisible()) toggleWidget(); });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ayarlar', click: openSettings },
    { label: "Widget'ı göster / gizle", click: toggleWidget },
    { label: 'Arka plan visualizer (aç/kapat)', click: openVisualizer },
    { type: 'separator' },
    { label: 'Çıkış', click: () => app.quit() },
  ]));
  screen.on('display-added', placeWidget);
  screen.on('display-removed', placeWidget);
  screen.on('display-metrics-changed', placeWidget);
});

app.on('second-instance', () => widget && widget.show());
app.on('window-all-closed', e => { /* tepside yaşamaya devam et */ });
