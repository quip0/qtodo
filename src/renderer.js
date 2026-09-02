'use strict';

// One repaint path: every mutation resolves to the whole state, we store it and
// redraw. The data is small enough (a day is a handful of strings) that
// diffing would only add a way for the screen and the file to disagree.

const $ = id => document.getElementById(id);

const el = $('cal');
const list = $('list');
const alerts = $('alerts');
const chips = $('chips');
const entry = $('entry');
const compose = $('compose');
const pop = $('pop');

// ---------- state ----------

let data = { categories: [], items: {}, alerts: {} };
let palette = [];
let today = todayYmd();

let sel = today;              // the selected day, 'YYYY-MM-DD'
let view = monthOf(sel);      // the month on screen, { y, m } with m 0-based
let kind = 'items';           // what the composer adds
let filter = null;            // category id the whole app is narrowed to, or null for all
let composeCat = null;        // category a new item is filed under
let cursor = -1;              // index into the day's visible rows, -1 for none
let editing = null;           // { kind, id } while a row is being edited in place

function monthOf(day) {
  const [y, m] = day.split('-').map(Number);
  return { y, m: m - 1 };
}

const alertsOn = day => data.alerts[day] || [];
const catById = id => data.categories.find(c => c.id === id) || null;

// Everything that draws items goes through here, so the category filter is
// applied in exactly one place and can't be forgotten by a new caller.
function itemsOn(day) {
  const all = data.items[day] || [];
  return filter ? all.filter(i => i.cat === filter) : all;
}

// ---------- month grid ----------
//
// Always six rows of seven. A fixed height keeps the cells from resizing as you
// page through months, which is what makes clicking the same date twice in a
// row land in the same place.

function gridDays(y, m) {
  const first = new Date(y, m, 1);
  const start = -first.getDay();                 // back up to the Sunday on or before the 1st
  const out = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 + start + i);
    out.push({ day: ymd(d), inMonth: d.getMonth() === m });
  }
  return out;
}

const MAX_PEEK = 2;      // list lines shown inside a cell
const MAX_DOTS = 3;      // alert dots shown inside a cell

function drawMonth() {
  $('monthname').textContent = `${MONTHS[view.m]} ${view.y}`;

  el.replaceChildren();
  for (const { day, inMonth } of gridDays(view.y, view.m)) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.dataset.day = day;
    cell.setAttribute('role', 'gridcell');
    if (!inMonth) cell.classList.add('other');
    if (day === today) cell.classList.add('today');
    if (day === sel) { cell.classList.add('sel'); cell.setAttribute('aria-selected', 'true'); }

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = Number(day.slice(8));
    cell.append(num);

    const dayAlerts = alertsOn(day);
    if (dayAlerts.length) {
      const dots = document.createElement('span');
      dots.className = 'dots';
      for (let i = 0; i < Math.min(dayAlerts.length, MAX_DOTS); i++) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dots.append(dot);
      }
      cell.append(dots);
    }

    const dayItems = itemsOn(day);
    for (const item of dayItems.slice(0, MAX_PEEK)) {
      const peek = document.createElement('span');
      peek.className = item.done ? 'peek done' : 'peek';
      peek.textContent = item.text;
      const cat = catById(item.cat);
      if (cat) peek.style.borderLeftColor = cat.color;
      cell.append(peek);
    }
    if (dayItems.length > MAX_PEEK) {
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = `+${dayItems.length - MAX_PEEK} more`;
      cell.append(more);
    }

    // The label is what a screen reader announces; the cell's own text is a
    // pile of fragments that wouldn't read as anything.
    cell.setAttribute('aria-label',
      `${prettyDay(day, today)}, ${count(dayItems.length, 'item')}, ${count(dayAlerts.length, 'alert')}`);

    el.append(cell);
  }
}

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// ---------- categories ----------

function swatch(cat, cls = 'swatch') {
  const s = document.createElement('span');
  s.className = cat ? `${cls} filed` : cls;
  if (cat) s.style.background = cat.color;
  return s;
}

// A chip's own color when it is the active filter, so the app states what it is
// narrowed to in the category's hue rather than in a generic highlight.
function paint(chip, cat, on) {
  chip.classList.toggle('on', on);
  chip.style.background = on ? (cat ? cat.color : 'var(--bg4)') : '';
  chip.style.borderColor = on ? (cat ? cat.color : 'var(--bg4)') : '';
  if (on && !cat) chip.style.color = 'var(--fg)';
}

// Items of a category across the month on screen — the number on each chip.
// Counted from the raw map rather than itemsOn(), which is already filtered.
function monthCount(catId) {
  return daysOfMonth().reduce((n, day) =>
    n + (data.items[day] || []).filter(i => catId === null ? true : i.cat === catId).length, 0);
}

function drawChips() {
  chips.replaceChildren();

  const all = document.createElement('button');
  all.className = 'chip';
  all.append(text('nm', 'all'), text('n', String(monthCount(null))));
  paint(all, null, filter === null);
  all.addEventListener('click', () => setFilter(null));
  chips.append(all);

  for (const cat of data.categories) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.append(swatch(cat), text('nm', cat.name), text('n', String(monthCount(cat.id))));
    paint(chip, cat, filter === cat.id);
    chip.title = `${cat.name} — click to filter, double-click to edit`;
    chip.addEventListener('click', () => setFilter(filter === cat.id ? null : cat.id));
    chip.addEventListener('dblclick', () => openCatEditor(chip, cat));
    chips.append(chip);
  }

  const add = document.createElement('button');
  add.className = 'chip add';
  add.textContent = '+ category';
  add.addEventListener('click', () => newCategory());
  chips.append(add);
}

function text(cls, s) {
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = s;
  return span;
}

// Creating a category is an input in the chip row rather than a dialog: it is
// one short string, and typing it where the chip will appear keeps the whole
// interaction in one place.
function newCategory() {
  closePop();
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 24;
  input.spellcheck = false;
  input.placeholder = 'category name';

  let closed = false;
  const close = commit => {
    if (closed) return;
    closed = true;
    const name = input.value;
    if (commit && name.trim()) api.addCategory(name).then(apply);
    else draw();
  };

  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') close(true);
    else if (e.key === 'Escape') close(false);
  });
  input.addEventListener('blur', () => close(false));

  chips.replaceChild(input, chips.lastChild);
  input.focus();
}

function setFilter(next) {
  filter = next;
  // A new item lands where you are looking: filtering to a category and typing
  // should not file the result somewhere else.
  if (next) composeCat = next;
  cursor = -1;
  draw();
}

// ---------- popover ----------
//
// One element, refilled by whoever opens it. Anchored under the thing that
// opened it and clamped to the window, so a chip near the right edge doesn't
// push its menu off screen.

let popCloser = null;

function openPop(anchor, build) {
  closePop();
  pop.replaceChildren();
  build(pop);
  pop.hidden = false;

  const a = anchor.getBoundingClientRect();
  const box = pop.getBoundingClientRect();
  const x = Math.max(6, Math.min(a.left, window.innerWidth - box.width - 6));
  const below = a.bottom + 4;
  // Flip above the anchor when there isn't room under it.
  const y = below + box.height > window.innerHeight - 6
    ? Math.max(6, a.top - box.height - 4)
    : below;
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;

  // Deferred: the click that opened the popover is still propagating.
  const onDown = e => { if (!pop.contains(e.target)) closePop(); };
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
  popCloser = () => document.removeEventListener('mousedown', onDown);
}

function closePop() {
  if (popCloser) { popCloser(); popCloser = null; }
  pop.hidden = true;
  pop.replaceChildren();
}

function popItem(parent, label, cat, { on = false, cls = '', onPick }) {
  const b = document.createElement('button');
  b.className = cls ? `popitem ${cls}` : 'popitem';
  if (cat !== undefined) b.append(swatch(cat));
  b.append(text('nm', label));
  if (on) b.append(text('tick', '✓'));
  b.addEventListener('click', () => { closePop(); onPick(); });
  parent.append(b);
  return b;
}

// Picking the category for one item, or for the composer when `item` is null.
function openCatPicker(anchor, item) {
  openPop(anchor, box => {
    const current = item ? item.cat : composeCat;
    const pick = id => {
      if (item) api.setCategory(sel, item.id, id).then(apply);
      else { composeCat = id; drawCompose(); }
    };

    box.append(text('poplabel', item ? 'file this item under' : 'file new items under'));
    popItem(box, 'unfiled', null, { on: current === null, onPick: () => pick(null) });
    for (const cat of data.categories) {
      popItem(box, cat.name, cat, { on: current === cat.id, onPick: () => pick(cat.id) });
    }

    const sep = document.createElement('div');
    sep.className = 'popsep';
    box.append(sep);
    popItem(box, 'new category…', undefined, { onPick: () => newCategory() });
  });
}

// Renaming, recoloring or deleting one category.
function openCatEditor(anchor, cat) {
  openPop(anchor, box => {
    box.append(text('poplabel', 'rename'));

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.spellcheck = false;
    input.value = cat.name;
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        closePop();
        if (input.value.trim() && input.value !== cat.name) {
          api.editCategory(cat.id, { name: input.value }).then(apply);
        }
      } else if (e.key === 'Escape') closePop();
    });
    box.append(input);

    const row = document.createElement('div');
    row.className = 'swatches';
    for (const color of palette) {
      const b = document.createElement('button');
      b.style.background = color;
      b.title = 'Use this color';
      if (color === cat.color) b.classList.add('on');
      b.addEventListener('click', () => {
        closePop();
        api.editCategory(cat.id, { color }).then(apply);
      });
      row.append(b);
    }
    box.append(row);

    const sep = document.createElement('div');
    sep.className = 'popsep';
    box.append(sep);

    // Worth spelling out, because "delete the folder" usually means the
    // contents go too, and here they deliberately don't.
    popItem(box, 'delete (items are kept)', undefined, {
      cls: 'danger',
      onPick: () => {
        if (filter === cat.id) filter = null;
        if (composeCat === cat.id) composeCat = null;
        api.removeCategory(cat.id).then(apply);
      },
    });

    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

// ---------- day pane ----------

// A row's action buttons. `defs` is [label, title, handler, className].
function actions(defs) {
  const wrap = document.createElement('span');
  wrap.className = 'act';
  for (const [label, title, fn, cls] of defs) {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    if (cls) b.className = cls;
    b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    wrap.append(b);
  }
  return wrap;
}

// Swaps a row's text for an input in place. Enter commits, Escape and blur
// cancel — so an accidental click elsewhere can't silently rewrite an entry.
function editRow(row, kind, id, text) {
  editing = { kind, id };
  const input = document.createElement('input');
  input.className = 'edit';
  input.type = 'text';
  input.maxLength = 200;
  input.spellcheck = false;
  input.value = text;

  let closed = false;
  const close = commit => {
    if (closed) return;
    closed = true;
    editing = null;
    const next = input.value;
    if (commit && next.trim() && next !== text) {
      const call = kind === 'items' ? api.editItem : api.editAlert;
      call(sel, id, next).then(apply);
    } else {
      draw();
    }
  };

  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') close(true);
    else if (e.key === 'Escape') close(false);
  });
  input.addEventListener('blur', () => close(false));

  row.querySelector('.txt').replaceWith(input);
  input.focus();
  input.select();
}

// The day's items in the order they are drawn: grouped by category, unfiled
// last. Returned flat so the keyboard cursor indexes one sequence regardless of
// how the list happens to be split into groups.
function rowsOf(day) {
  const items = itemsOn(day);
  if (filter) return items.map(item => ({ item }));

  const out = [];
  for (const cat of data.categories) {
    const group = items.filter(i => i.cat === cat.id);
    if (group.length) out.push(...group.map((item, i) => ({ item, head: i === 0 ? cat : null })));
  }
  const unfiled = items.filter(i => !catById(i.cat));
  // The unfiled heading is only worth drawing when something else is grouped
  // above it; a list with no categories at all is just a list.
  const head = out.length ? { id: null, name: 'unfiled', color: null } : null;
  out.push(...unfiled.map((item, i) => ({ item, head: i === 0 ? head : null })));
  return out;
}

function drawDay() {
  $('dayname').textContent = `${WEEKDAYS[weekdayOf(sel)]}, ${prettyDay(sel, today)}`;

  const items = itemsOn(sel);
  const done = items.filter(i => i.done).length;
  const cat = catById(filter);
  $('daycount').textContent = items.length
    ? `${done}/${items.length} done${cat ? ` in ${cat.name}` : ''}`
    : (cat ? `nothing in ${cat.name}` : '');
  // Clearing done items acts on what is on screen, so it follows the filter.
  $('clear').disabled = done === 0;

  alerts.replaceChildren();
  for (const a of alertsOn(sel)) {
    const row = document.createElement('div');
    row.className = 'alert';

    const bell = document.createElement('span');
    bell.textContent = '!';
    bell.setAttribute('aria-hidden', 'true');

    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = a.text;

    row.append(bell, txt, actions([
      ['✎', 'Edit this alert', () => editRow(row, 'alerts', a.id, a.text)],
      ['✕', 'Delete this alert', () => api.removeAlert(sel, a.id).then(apply), 'x'],
    ]));
    row.addEventListener('dblclick', () => editRow(row, 'alerts', a.id, a.text));
    alerts.append(row);
  }

  list.replaceChildren();
  const rows = rowsOf(sel);
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = cat ? `nothing filed under ${cat.name} today` : 'nothing on this day';
    list.append(empty);
  }

  rows.forEach(({ item, head }, i) => {
    if (head) {
      const h = document.createElement('div');
      h.className = head.color ? 'group' : 'group unfiled';
      if (head.color) h.append(swatch(head));
      h.append(text('nm', head.name),
               text('n', String(rows.filter(r => r.item.cat === head.id).length)));
      list.append(h);
    }

    const row = document.createElement('div');
    row.className = 'item' + (item.done ? ' on' : '') + (i === cursor ? ' sel' : '');

    const box = document.createElement('span');
    box.className = 'box';

    const itemCat = catById(item.cat);
    const dot = document.createElement('button');
    dot.className = itemCat ? 'cat filed' : 'cat';
    if (itemCat) dot.style.background = itemCat.color;
    dot.title = itemCat ? `${itemCat.name} — click to refile` : 'Unfiled — click to file';
    dot.addEventListener('click', e => { e.stopPropagation(); cursor = i; openCatPicker(dot, item); });

    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = item.text;

    row.append(box, dot, txt, actions([
      ['→', 'Move to the next day', () => api.moveItem(sel, item.id, addDays(sel, 1)).then(apply)],
      ['✎', 'Edit this item', () => editRow(row, 'items', item.id, item.text)],
      ['✕', 'Delete this item', () => api.removeItem(sel, item.id).then(apply), 'x'],
    ]));

    // Clicking the row is the toggle — the checkbox is a target, not the only
    // one. Editing is the double-click, so the two can't be confused.
    row.addEventListener('click', () => { cursor = i; api.toggleItem(sel, item.id).then(apply); });
    row.addEventListener('dblclick', () => { cursor = i; editRow(row, 'items', item.id, item.text); });

    list.append(row);
  });

  const monthItems = daysOfMonth().reduce((n, d) => n + itemsOn(d).length, 0);
  const monthAlerts = daysOfMonth().reduce((n, d) => n + alertsOn(d).length, 0);
  $('selinfo').textContent = `${MONTHS[view.m]}${cat ? ` · ${cat.name}` : ''}: `
    + `${count(monthItems, 'item')}, ${count(monthAlerts, 'alert')}`;

  $('headline').textContent = `${count(itemsOn(today).filter(i => !i.done).length, 'item')} left today`;
}

// The composer's category button, redrawn on its own so picking a category
// doesn't have to repaint the month.
function drawCompose() {
  const cat = catById(composeCat);
  const btn = $('catpick');
  btn.replaceChildren(swatch(cat), text('nm', cat ? cat.name : 'unfiled'));
}

// The days that actually belong to the month on screen (not the padding ones).
function daysOfMonth() {
  return gridDays(view.y, view.m).filter(d => d.inMonth).map(d => d.day);
}

function draw() {
  drawChips();
  drawMonth();
  drawDay();
  drawCompose();
}

// Stores a state that came back from the main process and repaints. Every
// mutation ends here.
function apply(next) {
  if (!next) return;
  data = { categories: next.categories || [], items: next.items || {}, alerts: next.alerts || {} };
  if (next.today) today = next.today;
  if (next.palette) palette = next.palette;

  // A category can vanish under us (deleted here, or an edited file on the next
  // load), and a filter pointing at nothing would silently hide every item.
  if (filter && !catById(filter)) filter = null;
  if (composeCat && !catById(composeCat)) composeCat = null;

  clampCursor();
  draw();
}

function clampCursor() {
  const n = rowsOf(sel).length;
  if (cursor >= n) cursor = n - 1;
  if (n === 0) cursor = -1;
}

// ---------- moving around ----------

function select(day, { follow = true } = {}) {
  sel = day;
  cursor = -1;
  // Selecting a day in the padding rows steps into that month, which is what
  // makes those cells worth clicking at all.
  if (follow) view = monthOf(day);
  draw();
}

function goMonth(delta) {
  const d = new Date(view.y, view.m + delta, 1);
  view = { y: d.getFullYear(), m: d.getMonth() };
  // Keep the selection on the same day-of-month where the month has one, so
  // paging back and forth doesn't lose your place.
  const dom = Number(sel.slice(8));
  const last = new Date(view.y, view.m + 1, 0).getDate();
  sel = ymd(new Date(view.y, view.m, Math.min(dom, last)));
  cursor = -1;
  draw();
}

// ---------- composing ----------

function setKind(next) {
  kind = next;
  for (const b of $('kind').children) b.classList.toggle('on', b.dataset.kind === kind);
  compose.classList.toggle('alerts', kind === 'alerts');
  entry.placeholder = kind === 'items' ? 'add an item…' : 'add an alert…';
}

function submit() {
  const text = entry.value;
  if (!text.trim()) return;
  const call = kind === 'items'
    ? () => api.addItem(sel, text, composeCat)
    : () => api.addAlert(sel, text);
  call().then(state => { entry.value = ''; apply(state); });
}

// ---------- wiring ----------

$('weekdays').replaceChildren(...WEEKDAYS.map(w => {
  const s = document.createElement('span');
  s.textContent = w;
  return s;
}));

el.addEventListener('click', e => {
  const cell = e.target.closest('.cell');
  if (cell) { select(cell.dataset.day); el.focus(); }
});

$('prev').addEventListener('click', () => goMonth(-1));
$('next').addEventListener('click', () => goMonth(1));
$('today').addEventListener('click', () => select(today));
// `filter ?? undefined`: null is the unfiled category, undefined is all of them.
$('clear').addEventListener('click', () => api.clearDone(sel, filter ?? undefined).then(apply));
$('add').addEventListener('click', submit);
$('catpick').addEventListener('click', () => openCatPicker($('catpick'), null));

for (const b of $('kind').children) {
  b.addEventListener('click', () => { setKind(b.dataset.kind); entry.focus(); });
}

entry.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); submit(); }
  else if (e.key === 'Escape') { entry.value = ''; el.focus(); }
});

// Keys are scoped to the pane that has focus: the calendar moves through days,
// the list moves through items. That way one arrow key never has to guess which
// of the two the user meant.
el.addEventListener('keydown', e => {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (step !== undefined) { e.preventDefault(); select(addDays(sel, step)); return; }
  if (e.key === 'Enter') { e.preventDefault(); entry.focus(); }
  else if (e.key === 't') select(today);
  else if (e.key === 'PageUp') { e.preventDefault(); goMonth(-1); }
  else if (e.key === 'PageDown') { e.preventDefault(); goMonth(1); }
});

list.addEventListener('keydown', e => {
  if (editing) return;
  const rows = rowsOf(sel);
  if (!rows.length) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = rows.length;
    cursor = cursor === -1
      ? (e.key === 'ArrowDown' ? 0 : n - 1)
      : (cursor + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    draw();
    return;
  }

  if (cursor === -1) return;
  const item = rows[cursor].item;

  if (e.key === ' ') { e.preventDefault(); api.toggleItem(sel, item.id).then(apply); }
  else if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    api.removeItem(sel, item.id).then(apply);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    editRow(list.querySelectorAll('.item')[cursor], 'items', item.id, item.text);
  } else if (e.key === 'c') {
    e.preventDefault();
    openCatPicker(list.querySelectorAll('.item')[cursor].querySelector('.cat'), item);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !pop.hidden) { closePop(); el.focus(); }
});

// ---------- menu commands ----------

api.onNewItem(() => { setKind('items'); entry.focus(); });
api.onNewAlert(() => { setKind('alerts'); entry.focus(); });
api.onNewCategory(() => newCategory());
api.onGoToday(() => select(today));
api.onGoMonth(goMonth);

api.onDayChanged(day => {
  const wasToday = sel === today;
  today = day;
  // Someone who left the app open on "today" means today, not that date.
  if (wasToday) select(day);
  else draw();
});

// A machine asleep past midnight can also come back without the main process
// noticing before the window is looked at again; re-asking on focus is the
// cheap backstop.
window.addEventListener('focus', () => { api.load().then(apply); });

setKind('items');

api.load().then(state => {
  today = state.today || todayYmd();
  palette = state.palette || [];
  data = {
    categories: state.categories || [],
    items: state.items || {},
    alerts: state.alerts || {},
  };
  select(today);
  el.focus();
});
