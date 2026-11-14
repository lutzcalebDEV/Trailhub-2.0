// Vale Trails — when was this file really taken?
// Phones stamp the capture time inside the file: JPEGs in EXIF (DateTimeOriginal),
// MP4/MOV videos in the movie header (creation_time). The file's "last modified"
// time is often just when it was saved or downloaded, so it's only a fallback.

const EXIF_DATE_ORIGINAL = 0x9003;
const EXIF_DATE_DIGITIZED = 0x9004;
const EXIF_SUB_IFD = 0x8769;

function readU16(view, off, little) { return view.getUint16(off, little); }
function readU32(view, off, little) { return view.getUint32(off, little); }

// "2026:11:05 17:42:10" in the camera's local time -> Date in this device's zone.
function parseExifDate(text) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text || "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : d;
}

function exifFromJpeg(buf) {
  const view = new DataView(buf);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 <= view.byteLength) {
    if (view.getUint8(off) !== 0xff) return null;
    const marker = view.getUint8(off + 1);
    const size = view.getUint16(off + 2);
    if (marker === 0xe1 && off + 10 <= view.byteLength) {
      const sig = String.fromCharCode(...new Uint8Array(buf, off + 4, 6));
      if (sig.startsWith("Exif")) return readTiff(view, off + 10, Math.min(size - 8, view.byteLength - off - 10));
    }
    if (marker === 0xda) return null; // image data: no EXIF before it
    off += 2 + size;
  }
  return null;
}

function readTiff(view, base, length) {
  const end = base + length;
  if (base + 8 > end) return null;
  const little = view.getUint16(base) === 0x4949;
  if (view.getUint16(base + 2, little) !== 42) return null;
  const readIfd = (off, want) => {
    const out = {};
    if (off + 2 > end) return out;
    const n = readU16(view, off, little);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > end) break;
      const tag = readU16(view, e, little);
      if (!want.has(tag)) continue;
      const type = readU16(view, e + 2, little);
      const count = readU32(view, e + 4, little);
      if (type === 4 && count === 1) { out[tag] = readU32(view, e + 8, little); continue; }
      if (type === 2) {
        const at = count <= 4 ? e + 8 : base + readU32(view, e + 8, little);
        if (at + count > end) continue;
        out[tag] = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + at, count - 1));
      }
    }
    return out;
  };
  const ifd0 = readIfd(base + readU32(view, base + 4, little), new Set([EXIF_SUB_IFD]));
  if (ifd0[EXIF_SUB_IFD] == null) return null;
  const sub = readIfd(base + ifd0[EXIF_SUB_IFD], new Set([EXIF_DATE_ORIGINAL, EXIF_DATE_DIGITIZED]));
  return parseExifDate(sub[EXIF_DATE_ORIGINAL]) || parseExifDate(sub[EXIF_DATE_DIGITIZED]);
}

// Walk the MP4/MOV atoms (reading headers only, so an 80 MB file costs a few KB)
// until moov > mvhd, whose creation_time is seconds since 1904 in UTC.
const MP4_EPOCH_MS = Date.UTC(1904, 0, 1);
async function dateFromMp4(file) {
  const header = async (at) => {
    const b = new DataView(await file.slice(at, at + 16).arrayBuffer());
    if (b.byteLength < 8) return null;
    let size = b.getUint32(0);
    const type = String.fromCharCode(b.getUint8(4), b.getUint8(5), b.getUint8(6), b.getUint8(7));
    let head = 8;
    if (size === 1 && b.byteLength >= 16) { size = Number(b.getBigUint64(8)); head = 16; }
    else if (size === 0) size = file.size - at;
    return size >= head ? { size, type, head } : null;
  };
  let off = 0;
  for (let i = 0; i < 64 && off + 8 <= file.size; i++) {
    const a = await header(off);
    if (!a) return null;
    if (a.type === "moov") {
      let inner = off + a.head;
      const stop = off + a.size;
      while (inner + 8 <= stop) {
        const m = await header(inner);
        if (!m) return null;
        if (m.type === "mvhd") {
          const b = new DataView(await file.slice(inner + m.head, inner + m.head + 20).arrayBuffer());
          if (b.byteLength < 8) return null;
          const version = b.getUint8(0);
          const secs = version === 1 ? Number(b.getBigUint64(4)) : b.getUint32(4);
          if (!secs) return null;
          const d = new Date(MP4_EPOCH_MS + secs * 1000);
          return d.getFullYear() < 2000 || d.getTime() > Date.now() + 86400000 ? null : d;
        }
        inner += m.size;
      }
      return null;
    }
    off += a.size;
  }
  return null;
}

// The best capture date for a picked file, and where it came from.
export async function captureDate(file) {
  try {
    if (file.type.startsWith("video/") || /\.(mp4|mov|m4v)$/i.test(file.name)) {
      const d = await dateFromMp4(file);
      if (d) return { date: d, source: "video" };
    } else {
      const head = await file.slice(0, 256 * 1024).arrayBuffer();
      const d = exifFromJpeg(head);
      if (d) return { date: d, source: "exif" };
    }
  } catch (e) { /* fall through to the file time */ }
  const mod = new Date(file.lastModified || Date.now());
  return { date: isNaN(mod.getTime()) ? new Date() : mod, source: "file" };
}
