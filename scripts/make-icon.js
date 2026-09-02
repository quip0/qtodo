// Procedurally draws the app icon (a calendar page whose rows are the day's
// list, with one red dot for an alert) and writes an .icns. Done in code rather
// than shipping a binary asset so the icon can be tweaked by editing colors
// here — no image editor and no npm dependency.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const BG_TOP = hex('#32302f');
const BG_BOT = hex('#1d2021');
const BAND   = hex('#83a598');   // the calendar page's header strip
const ROW    = hex('#ebdbb2');   // a list item
const ROW_D  = hex('#665c54');   // a done item, struck from the list
const ALERT  = hex('#fb4934');

// Geometry in 0..1 units of the icon square.
const PAD = 0.055, R = 0.20;
const BAND_BOT = 0.29;           // where the header strip ends

// Two binder rings punched out of the strip — what makes the card read as a
// calendar page rather than a plain card. [x, y0, y1].
const RING_W = 0.038;
const RINGS = [[0.36, 0.11, 0.20], [0.64, 0.11, 0.20]];

// List rows, each drawn as a capsule: [x0, x1, y].
const RW = 0.042;                // capsule half-height
const ROWS = [
  [0.22, 0.66, 0.47],
  [0.22, 0.72, 0.63],
  [0.22, 0.50, 0.79],            // the last row is the done one
];

const DOT = [0.755, 0.785, 0.088];   // alert marker: cx, cy, r

// Distance from point (x,y) to the segment (ax,ay)-(bx,by).
function distSeg(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// Returns [r,g,b,a] at a point in 0..1 space.
function sample(x, y) {
  if (!inRoundRect(x, y, PAD, PAD, 1 - PAD, 1 - PAD, R)) return [0, 0, 0, 0];

  // The alert dot sits on top of everything, the way it does in the UI.
  if (Math.hypot(x - DOT[0], y - DOT[1]) < DOT[2]) return [...ALERT, 255];

  for (let i = 0; i < ROWS.length; i++) {
    const [x0, x1, ry] = ROWS[i];
    if (distSeg(x, y, x0, ry, x1, ry) < RW) {
      return [...(i === ROWS.length - 1 ? ROW_D : ROW), 255];
    }
  }

  if (y < BAND_BOT) {
    for (const [rx, y0, y1] of RINGS) {
      if (distSeg(x, y, rx, y0, rx, y1) < RING_W) return [...BG_TOP, 255];
    }
    return [...BAND, 255];
  }

  const t = (y - PAD) / (1 - 2 * PAD);
  return [...BG_TOP.map((c, i) => Math.round(c + (BG_BOT[i] - c) * t)), 255];
}

function render(size) {
  const SS = 3;                                  // supersampling for antialiasing
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [sr, sg, sb, sa] = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += sr * sa; g += sg * sa; b += sb * sa; a += sa;
        }
      }
      const o = (py * size + px) * 4;
      if (a > 0) { buf[o] = r / a; buf[o + 1] = g / a; buf[o + 2] = b / a; }
      buf[o + 3] = a / (SS * SS);
    }
  }
  return buf;
}

function png(size, rgba) {
  // Raw scanlines, each prefixed with filter type 0.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Fallback for Node versions without zlib.crc32.
let table = null;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Builds an .icns at `out`. Returns out.
module.exports = function makeIcon(out) {
  const set = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-icon-')) + '/icon.iconset';
  fs.mkdirSync(set);
  for (const base of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(set, `icon_${base}x${base}.png`), png(base, render(base)));
    fs.writeFileSync(path.join(set, `icon_${base}x${base}@2x.png`), png(base * 2, render(base * 2)));
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', out]);
  fs.rmSync(path.dirname(set), { recursive: true, force: true });
  return out;
};

if (require.main === module) module.exports(process.argv[2] || 'appicon.icns');
