const { app, BrowserWindow, Menu, ipcMain, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { isDay, todayYmd } = require('./src/dates');

app.setName('Todo');

const WIN = { width: 1080, height: 720, minWidth: 780, minHeight: 560 };

let win = null;

// ---------- persisted state ----------
//
// One small JSON file, keyed by local calendar day:
//
//   { categories: [ { id, name, color, created } ],
//     items:  { 'YYYY-MM-DD': [ { id, text, done, cat, created } ] },
//     alerts: { 'YYYY-MM-DD': [ { id, text, created } ] } }
//
// Items and alerts are separate maps rather than one list with a flag. That is
// the whole point of an alert: it marks the day without occupying a line in the
// list, so it must not be something a list render has to remember to filter
// out. Days with nothing on them are absent, so a fresh install is `{}` and a
// busy year is a few tens of KB.
//
// A category is a folder for items, and `cat` is a reference to one rather than
// a copy of its name — renaming or recoloring a category has to reach every
// item already in it, and a copied name would leave the old one behind on every
// item written before the rename. `cat` is null for an unfiled item, and
// deleting a category unfiles its items rather than deleting them: losing a
// folder should never mean losing what was in it.

const FILE = () => path.join(app.getPath('userData'), 'todo.json');

let state = { categories: [], items: {}, alerts: {} };

const MAX_TEXT = 200;
const MAX_NAME = 24;          // a category name has to fit in a chip
const MAX_PER_DAY = 500;      // a runaway loop shouldn't be able to grow the file forever
const MAX_CATEGORIES = 40;

// Categories pick from a fixed palette rather than a free color picker: eight
// hues that are legible on this background and tell each other apart, so no
// choice a user makes can produce an invisible chip. gruvbox, matching the UI.
const PALETTE = ['#83a598', '#b8bb26', '#fabd2f', '#fe8019',
                 '#d3869b', '#8ec07c', '#fb4934', '#a89984'];

// The first color nobody is using, so the first eight categories are always
// visibly distinct — including the ones that arrive from a hand-edited file
// with a color the palette doesn't have. Past eight it wraps and repeats,
// which is the honest limit of a fixed palette.
function nextColor(used) {
  return PALETTE.find(c => !used.has(c)) || PALETTE[used.size % PALETTE.length];
}

function cleanText(v) {
  if (typeof v !== 'string') return null;
  const text = v.trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
  return text || null;
}

// Returns an entry built only from fields that validate, or null. Used for both
// incoming IPC and the on-disk file, so a hand-edited todo.json is held to
// exactly the same standard as the UI.
//
// `catIds` is the set of categories that actually exist. An item naming one
// that doesn't is unfiled rather than rejected — a dangling reference is a
// broken folder, not a broken task.
function cleanEntry(raw, kind, catIds) {
  if (!raw || typeof raw !== 'object') return null;
  const text = cleanText(raw.text);
  if (!text) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID().slice(0, 8),
    text,
    ...(kind === 'items' ? {
      done: raw.done === true,
      cat: catIds && catIds.has(raw.cat) ? raw.cat : null,
    } : {}),
    created: Number(raw.created) || Date.now(),
  };
}

function cleanCategory(raw, fallbackId, fallbackColor) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string'
    ? raw.name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME)
    : '';
  if (!name) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : fallbackId,
    name,
    color: PALETTE.includes(raw.color) ? raw.color : fallbackColor,
    created: Number(raw.created) || Date.now(),
  };
}

// The one gate everything untrusted passes through. Returns a state built only
// from what validates, so no caller has to trust its input.
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const out = { categories: [], items: {}, alerts: {} };

  // Categories first: the items validate against them.
  const seenCats = new Set();
  const usedColors = new Set();
  for (const cat of Array.isArray(raw.categories) ? raw.categories : []) {
    if (out.categories.length >= MAX_CATEGORIES) break;
    const clean = cleanCategory(cat, crypto.randomUUID().slice(0, 8), nextColor(usedColors));
    if (!clean || seenCats.has(clean.id)) continue;
    seenCats.add(clean.id);
    usedColors.add(clean.color);
    out.categories.push(clean);
  }

  for (const kind of ['items', 'alerts']) {
    const days = raw[kind] && typeof raw[kind] === 'object' ? raw[kind] : {};
    for (const [day, list] of Object.entries(days)) {
      if (!isDay(day) || !Array.isArray(list)) continue;
      const seen = new Set();
      const kept = [];
      for (const entry of list.slice(0, MAX_PER_DAY)) {
        const clean = cleanEntry(entry, kind, seenCats);
        if (!clean || seen.has(clean.id)) continue;
        seen.add(clean.id);
        kept.push(clean);
      }
      if (kept.length) out[kind][day] = kept;
    }
  }
  return out;
}

function loadState() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
  } catch { return; }
  const clean = sanitize(raw);
  if (clean) state = clean;
}

// Written through a temp file + rename so a crash mid-write can't truncate the
// only copy of the list.
let saveTimer = null;

function writeState() {
  const file = FILE();
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('todo: could not save:', err.message);
  }
}

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; writeState(); }, 300);
}

function flushState() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeState();
}

// A day's list, created on demand. Empty days are deleted again by `prune` so
// they never reach the file.
function listOf(kind, day) {
  return state[kind][day] || (state[kind][day] = []);
}

function prune(kind, day) {
  if (state[kind][day] && !state[kind][day].length) delete state[kind][day];
}

function newId(kind, day) {
  const list = state[kind][day] || [];
  let id;
  do { id = crypto.randomUUID().slice(0, 8); } while (list.some(e => e.id === id));
  return id;
}

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    ...WIN,
    title: 'Todo',
    backgroundColor: '#1d2021',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // The launcher sends stdout to ~/Library/Logs/todo-launch.log, so forwarding
  // renderer errors there is the only way a crash in the UI leaves a trace —
  // otherwise a blank window is all you get.
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`todo[renderer] ${source}:${line} ${message}`);
  });

  win.loadFile('index.html');
  win.on('closed', () => { win = null; });
}

// ---------- the day rollover ----------
//
// "Today" is a highlighted cell and the month the app opens on, so it has to
// notice midnight passing while the window sits open. A timer covers the
// ordinary case and a wake handler covers the laptop that was closed overnight,
// since timers don't fire while the machine is asleep.

let dayTimer = null;
let currentDay = todayYmd();

function scheduleMidnight() {
  clearTimeout(dayTimer);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  // setTimeout saturates past ~24.8 days; the delay here is always under a day,
  // but clamp anyway so a clock jump can't wrap it to a fire-immediately loop.
  dayTimer = setTimeout(checkDay, Math.min(Math.max(midnight - now, 1000), 2 ** 31 - 1));
}

function checkDay() {
  const day = todayYmd();
  if (day !== currentDay) {
    currentDay = day;
    win?.webContents.send('day-changed', day);
  }
  scheduleMidnight();
}

// ---------- ipc ----------
//
// Every mutation resolves to the whole (small) state rather than a diff — the
// renderer then has one repaint path and can't drift out of sync with the file.

// The palette travels with the state so the renderer's swatch row can't drift
// out of step with what the main process will actually accept.
ipcMain.handle('load', () => ({ ...state, today: todayYmd(), palette: PALETTE }));

// `kind` is checked against the two known maps rather than used to index
// directly: an unchecked string from the renderer would otherwise reach
// Object.prototype through state[kind].
const KINDS = new Set(['items', 'alerts']);

const catIds = () => new Set(state.categories.map(c => c.id));

ipcMain.handle('add', (_e, kind, day, text, cat) => {
  if (!KINDS.has(kind) || !isDay(day)) return state;
  const entry = cleanEntry({ text, cat, id: newId(kind, day) }, kind, catIds());
  if (!entry) return state;

  const list = listOf(kind, day);
  if (list.length >= MAX_PER_DAY) return state;
  list.push(entry);

  saveState();
  return state;
});

ipcMain.handle('remove', (_e, kind, day, id) => {
  if (!KINDS.has(kind) || !isDay(day) || !state[kind][day]) return state;
  state[kind][day] = state[kind][day].filter(e => e.id !== id);
  prune(kind, day);
  saveState();
  return state;
});

// Editing text in place, so a typo doesn't cost a delete and a retype.
ipcMain.handle('edit', (_e, kind, day, id, text) => {
  if (!KINDS.has(kind) || !isDay(day)) return state;
  const entry = (state[kind][day] || []).find(e => e.id === id);
  const clean = cleanText(text);
  if (!entry || !clean) return state;
  entry.text = clean;
  saveState();
  return state;
});

ipcMain.handle('toggle', (_e, day, id) => {
  if (!isDay(day)) return state;
  const item = (state.items[day] || []).find(e => e.id === id);
  if (!item) return state;
  item.done = !item.done;
  saveState();
  return state;
});

// Moving an item to another day — what "I'll do it tomorrow" actually is. The
// entry keeps its id (ids are only unique within a day) unless the target day
// already holds one, which a hand-edited file could arrange.
ipcMain.handle('move', (_e, day, id, toDay) => {
  if (!isDay(day) || !isDay(toDay) || day === toDay) return state;
  const list = state.items[day] || [];
  const i = list.findIndex(e => e.id === id);
  if (i === -1) return state;

  const target = listOf('items', toDay);
  if (target.length >= MAX_PER_DAY) return state;

  const [item] = list.splice(i, 1);
  prune('items', day);
  if (target.some(e => e.id === item.id)) item.id = newId('items', toDay);
  target.push(item);

  saveState();
  return state;
});

// The renderer sends the full desired order; anything it omits keeps its
// relative position at the end, so a stale list can reorder but never delete.
ipcMain.handle('reorder', (_e, day, ids) => {
  if (!isDay(day) || !Array.isArray(ids) || !state.items[day]) return state;
  const rank = new Map(ids.map((id, i) => [id, i]));
  state.items[day].sort((a, b) =>
    (rank.has(a.id) ? rank.get(a.id) : Infinity) - (rank.has(b.id) ? rank.get(b.id) : Infinity));
  saveState();
  return state;
});

// Clearing the finished items off a day, which is the common bulk action. It
// takes the category the UI is filtered to, because a button that says "clear
// done" next to a filtered list must not also clear what that list is hiding.
// `undefined` is every category; `null` is the unfiled ones.
ipcMain.handle('clear-done', (_e, day, cat) => {
  if (!isDay(day) || !state.items[day]) return state;
  const inScope = item => cat === undefined || item.cat === cat;
  state.items[day] = state.items[day].filter(e => !(e.done && inScope(e)));
  prune('items', day);
  saveState();
  return state;
});

// ---------- categories ----------
//
// Folders for items. Every handler below leaves the items alone: a category is
// a label on the side, so no edit to one can lose a task.

const catById = id => state.categories.find(c => c.id === id) || null;

ipcMain.handle('add-category', (_e, name) => {
  if (state.categories.length >= MAX_CATEGORIES) return state;

  let id;
  do { id = crypto.randomUUID().slice(0, 8); } while (catById(id));

  const cat = cleanCategory({ name, id }, id, nextColor(new Set(state.categories.map(c => c.color))));
  if (!cat) return state;

  state.categories.push(cat);
  saveState();
  return state;
});

ipcMain.handle('edit-category', (_e, id, patch) => {
  const cat = catById(id);
  if (!cat || !patch || typeof patch !== 'object') return state;
  const merged = cleanCategory({ ...cat, ...patch, id: cat.id, created: cat.created }, cat.id, cat.color);
  if (!merged) return state;
  Object.assign(cat, merged);
  saveState();
  return state;
});

// Deleting a category unfiles its items rather than deleting them.
ipcMain.handle('delete-category', (_e, id) => {
  if (!catById(id)) return state;
  state.categories = state.categories.filter(c => c.id !== id);
  for (const list of Object.values(state.items)) {
    for (const item of list) if (item.cat === id) item.cat = null;
  }
  saveState();
  return state;
});

// Filing one item. `null` unfiles it, and an unknown category does the same
// rather than writing a reference that nothing resolves.
ipcMain.handle('set-category', (_e, day, id, cat) => {
  if (!isDay(day)) return state;
  const item = (state.items[day] || []).find(e => e.id === id);
  if (!item) return state;
  item.cat = catById(cat) ? cat : null;
  saveState();
  return state;
});

// ---------- menu ----------
//
// The single-key bindings (n, a, enter, arrows) are deliberately NOT
// accelerators: Electron matches accelerators before the focused element sees
// the key, so they would be swallowed while typing into the new-item field.
// The renderer binds them and skips them when an input has focus.
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Item', accelerator: 'CmdOrCtrl+N', click: () => win?.webContents.send('new-item') },
        { label: 'New Alert', accelerator: 'CmdOrCtrl+Shift+N', click: () => win?.webContents.send('new-alert') },
        { label: 'New Category…', accelerator: 'CmdOrCtrl+Shift+C', click: () => win?.webContents.send('new-category') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        { label: 'Today', accelerator: 'CmdOrCtrl+T', click: () => win?.webContents.send('go-today') },
        { label: 'Previous Month', accelerator: 'CmdOrCtrl+[', click: () => win?.webContents.send('go-month', -1) },
        { label: 'Next Month', accelerator: 'CmdOrCtrl+]', click: () => win?.webContents.send('go-month', 1) },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
}

// ---------- lifecycle ----------

// Two copies would each hold the whole file in memory and write it back
// wholesale, so the second one to save would silently erase whatever the first
// had recorded. Refuse to be the second copy and surface the first instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    loadState();
    buildMenu();
    createWindow();
    scheduleMidnight();
    // Timers don't fire while the machine is asleep, so a laptop closed
    // overnight wakes with yesterday still highlighted without this.
    powerMonitor.on('resume', checkDay);
  });
}

// Electron keeps running after the last window closes, and qcommand relies on
// that: it re-sends the Dock's reopen event to build a window again.
app.on('activate', () => { if (!win) createWindow(); });
app.on('before-quit', flushState);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
