const { contextBridge, ipcRenderer } = require('electron');

// Every mutation resolves to the whole (small) state rather than a diff — the
// renderer then has one repaint path and can't drift out of sync with the file.
//
// Exposed as `api`, not `todo`: contextBridge installs the bridge as a
// non-configurable property of window, and a top-level `let todo` in the
// renderer would then be a SyntaxError ("already been declared") that silently
// takes the entire script with it.
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('load'),

  addItem: (day, text, cat) => ipcRenderer.invoke('add', 'items', day, text, cat),
  editItem: (day, id, text) => ipcRenderer.invoke('edit', 'items', day, id, text),
  removeItem: (day, id) => ipcRenderer.invoke('remove', 'items', day, id),
  toggleItem: (day, id) => ipcRenderer.invoke('toggle', day, id),
  setQuantity: (day, id, n) => ipcRenderer.invoke('set-quantity', day, id, n),
  moveItem: (day, id, toDay) => ipcRenderer.invoke('move', day, id, toDay),
  reorderItems: (day, ids) => ipcRenderer.invoke('reorder', day, ids),
  clearDone: (day, cat) => ipcRenderer.invoke('clear-done', day, cat),

  addAlert: (day, text) => ipcRenderer.invoke('add', 'alerts', day, text),
  editAlert: (day, id, text) => ipcRenderer.invoke('edit', 'alerts', day, id, text),
  removeAlert: (day, id) => ipcRenderer.invoke('remove', 'alerts', day, id),

  addCategory: name => ipcRenderer.invoke('add-category', name),
  editCategory: (id, patch) => ipcRenderer.invoke('edit-category', id, patch),
  removeCategory: id => ipcRenderer.invoke('delete-category', id),
  setCategory: (day, id, cat) => ipcRenderer.invoke('set-category', day, id, cat),

  // Midnight passed (or the machine woke into a new day) while the app was open.
  onDayChanged: fn => ipcRenderer.on('day-changed', (_e, day) => fn(day)),
  onNewItem: fn => ipcRenderer.on('new-item', fn),
  onNewAlert: fn => ipcRenderer.on('new-alert', fn),
  onNewCategory: fn => ipcRenderer.on('new-category', fn),
  onGoToday: fn => ipcRenderer.on('go-today', fn),
  onGoMonth: fn => ipcRenderer.on('go-month', (_e, delta) => fn(delta)),
});
