'use strict';

// Calendar-day helpers shared by the main process and the renderer. Both sides
// validate which days are editable, so the arithmetic has to agree exactly —
// hence one file loaded two ways: as a plain <script> in the renderer (where it
// defines globals) and via require() in main.js.
//
// A day is a local calendar date written 'YYYY-MM-DD'. Two rules keep that
// honest:
//
//   - Never build a day string from toISOString(). That converts to UTC, so
//     every evening west of Greenwich would file today's item under
//     tomorrow.
//   - Never do day arithmetic by adding 86400000ms to a timestamp. DST
//     transitions make days 23 or 25 hours long, so a "+1 day" drifts and
//     eventually repeats or skips a date. Day *offsets* go through UTC epoch
//     days instead, where every day is exactly 24h by definition, and day
//     *fields* go through the Date(y, m, d) constructor, which normalizes
//     out-of-range values correctly.

const MS_PER_DAY = 86400000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad2 = n => String(n).padStart(2, '0');

// Local calendar date of a Date object, as 'YYYY-MM-DD'.
function ymd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayYmd() {
  return ymd(new Date());
}

// Whether a value is a well-formed day string that names a real date. The regex
// alone accepts '2026-02-31', so round-trip through the constructor to reject
// days that don't exist.
function isDay(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  return ymd(parseDay(s)) === s;
}

// 'YYYY-MM-DD' -> local Date at midnight.
function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Days since the epoch. Only ever compared or differenced with another one, so
// the UTC framing is an implementation detail — it just guarantees uniform days.
function epochDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function fromEpochDay(n) {
  const d = new Date(n * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(day, n) {
  return fromEpochDay(epochDay(day) + n);
}

// Inclusive span: daysBetween(d, d) === 1.
function daysBetween(from, to) {
  return epochDay(to) - epochDay(from) + 1;
}

// 0 = Sunday. Reads the weekday off the local date rather than the epoch-day
// modulo, so it stays right regardless of how the string was produced.
function weekdayOf(day) {
  return parseDay(day).getDay();
}

// 'Mar 4' / 'Mar 4, 2025' — the year only when it isn't the current one.
function prettyDay(day, today = todayYmd()) {
  const [y, m, d] = day.split('-').map(Number);
  const sameYear = y === Number(today.slice(0, 4));
  return `${MONTHS[m - 1]} ${d}${sameYear ? '' : `, ${y}`}`;
}

// Note that day strings sort lexicographically, so ranges elsewhere in the app
// are plain string comparisons rather than anything that needs these helpers.

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WEEKDAYS, MONTHS, ymd, todayYmd, isDay, parseDay, epochDay, fromEpochDay,
    addDays, daysBetween, weekdayOf, prettyDay,
  };
}
