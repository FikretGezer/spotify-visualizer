const { contextBridge, ipcRenderer } = require('electron');

// widget penceresi
contextBridge.exposeInMainWorld('widget', {
  setInteractive: on => ipcRenderer.send('interactive', !!on),
  onToggleMini: cb => ipcRenderer.on('toggleMini', () => cb()),
  fit: r => ipcRenderer.send('fit', r),
  onFade: cb => ipcRenderer.on('fade', (_e, on, instant) => cb(on, instant)),
  onDocked: cb => ipcRenderer.on('docked', (_e, d, clip, shift) => cb(d, clip, shift)),
  onFlipOut: cb => ipcRenderer.on('flipOut', () => cb()),
  onFlip: cb => ipcRenderer.on('flip', (_e, on) => cb(on)),
  onPeek: cb => ipcRenderer.on('peek', (_e, on) => cb(on)),
  onClosePlayer: cb => ipcRenderer.on('closePlayer', () => cb()),
  onHover: cb => ipcRenderer.on('hover', (_e, id) => cb(id)),
  setHitRects: r => ipcRenderer.send('hitrects', r),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  dragStart: (x, y) => ipcRenderer.send('drag:start', x, y),
  dragMove: (x, y) => ipcRenderer.send('drag:move', x, y),
  dragEnd: () => ipcRenderer.invoke('drag:end'),
  onReveal: cb => ipcRenderer.on('reveal', () => cb(true)),
  onUnreveal: cb => ipcRenderer.on('unreveal', () => cb(false)),
  contextMenu: () => ipcRenderer.send('ctxmenu'),
  onSettings: cb => ipcRenderer.on('settings:changed', (_e, cfg) => cb(cfg)),
});

// ayarlar penceresi
contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (k, v) => ipcRenderer.send('settings:set', k, v),
  displays: () => ipcRenderer.invoke('settings:displays'),
  action: a => ipcRenderer.send('settings:action', a),
  onState: cb => ipcRenderer.on('settings:state', (_e, s) => cb(s)),
  onRefresh: cb => ipcRenderer.on('settings:refresh', () => cb()),
});
