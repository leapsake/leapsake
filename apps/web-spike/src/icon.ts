import { deflateSync } from "node:zlib";

/**
 * A PNG, drawn by arithmetic, because **Chrome will not offer to install a PWA
 * without one**.
 *
 * Increment 5d needs an *installed* origin, not a pretty one: `persist()` was
 * refused on `localhost` in 5e, and "Chrome grants durability to installed
 * origins" is the hypothesis that needs an install to test. Chrome's install
 * criteria want a manifest with a 192 px and a 512 px icon, so the spike either
 * commits two binaries to a throwaway app, adds an image dependency, or bets on
 * Chrome accepting an SVG. Forty lines of `zlib` is the cheapest of the three
 * and the only one with no external anything.
 *
 * Two flat colours, the mark kept inside the middle 60% so the same file works
 * as `purpose: "maskable"` (Android crops a maskable icon to whatever shape the
 * launcher uses, and only the inner ~80% is guaranteed to survive).
 */

/** PNG chunk CRCs are the standard IEEE 802.3 CRC-32, table built on first use. */
const CRC_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** `length | type | data | crc(type + data)`, which is every chunk in the format. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(body.length + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(out.length - 4, crc32(body));
  return out;
}

/** A rounded-ish square mark on a solid ground, as a truecolour 8-bit PNG. */
export function iconPng(size: number): Uint8Array {
  const ground: [number, number, number] = [0x10, 0x3d, 0x3a];
  const mark: [number, number, number] = [0x63, 0xd2, 0xbf];
  const inset = Math.round(size * 0.22);
  const radius = Math.round(size * 0.12);

  // One filter byte (0 — none) per row, then RGB triples. Filtering would shrink
  // it; two colours already deflate to a few hundred bytes.
  const raw = new Uint8Array(size * (1 + size * 3));
  let at = 0;
  for (let y = 0; y < size; y++) {
    raw[at++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = inMark(x, y, size, inset, radius) ? mark : ground;
      raw[at++] = r;
      raw[at++] = g;
      raw[at++] = b;
    }
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, size);
  headerView.setUint32(4, size);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type 2 — truecolour, no alpha
  // 10-12: compression 0, filter 0, interlace 0, all already zero.

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** Inside the inset square, with the four corners rounded off by distance. */
function inMark(
  x: number,
  y: number,
  size: number,
  inset: number,
  radius: number,
): boolean {
  const low = inset;
  const high = size - inset - 1;
  if (x < low || x > high || y < low || y > high) return false;

  const cornerX = x < low + radius ? low + radius : x > high - radius ? high - radius : x;
  const cornerY = y < low + radius ? low + radius : y > high - radius ? high - radius : y;
  return (x - cornerX) ** 2 + (y - cornerY) ** 2 <= radius ** 2;
}
