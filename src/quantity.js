'use strict';

// Quantity items, shared by the main process and the renderer — loaded as a
// plain <script> in the renderer (where it defines globals) and via require()
// in main.js, the same trick src/dates.js uses. Both sides decide whether an
// item is complete, so the rule has to live in exactly one place.
//
// An item whose text starts with a small number is a quantity: "3 chapters" is
// a thing to do three times, tracked as `have` out of three, rather than one
// checkbox. Nothing else marks it — no mode to switch on, no second field to
// fill in — so the text stays the single thing the user typed and edits to it
// re-parse into a new target.

// Targets stop at 99 on purpose. Above that a leading number is almost never a
// quantity — "2026 review", "1984 reread", "100 push-ups" is the rare loss —
// and a four-figure target would make a stepper useless anyway.
const MAX_TARGET = 99;

// A leading integer, whitespace, then something left to name the thing. Targets
// start at 2: "1 coffee" is a single checkbox already, and turning it into a
// 0/1 stepper would be worse than leaving the text alone.
const QUANTITY_RE = /^(\d{1,4})\s+(\S.*)$/;

// Returns { target, label } for a quantity item, or null for an ordinary one.
// `label` is the text with the count stripped, since the count is drawn as a
// badge — showing both would say five twice.
function parseQuantity(text) {
  if (typeof text !== 'string') return null;
  const m = QUANTITY_RE.exec(text.trim());
  if (!m) return null;
  const target = Number(m[1]);
  if (!Number.isInteger(target) || target < 2 || target > MAX_TARGET) return null;
  return { target, label: m[2] };
}

// How many of a quantity item are done. Clamped here rather than trusted from
// the item, so a stale or hand-edited `have` can't exceed its target.
function have(item, q) {
  const n = Math.floor(Number(item.have) || 0);
  return Math.min(Math.max(n, 0), q.target);
}

// The one definition of "done", for both kinds of item. A quantity item has no
// stored `done` flag at all — it is complete when it reaches its target, and a
// second stored copy of that could only ever disagree with the count.
function isDone(item) {
  const q = parseQuantity(item.text);
  return q ? have(item, q) >= q.target : item.done === true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAX_TARGET, parseQuantity, have, isDone };
}
