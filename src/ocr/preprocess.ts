import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import type { Region } from '../config/config';

let _dump = 0;

export interface PreprocessResult {
  buffer: ArrayBuffer;
  width:  number;
  height: number;
}

const SCALE = 4;

export async function preprocessBlueRegion(
  rawRGBA:   Buffer,
  srcWidth:  number,
  srcHeight: number,
  region:    Region
): Promise<PreprocessResult> {
  const cropped = await sharp(rawRGBA, {
    raw: { width: srcWidth, height: srcHeight, channels: 4 },
  })
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .raw()
    .toBuffer();

  const bw = applyBlueFilter(cropped, region.width, region.height);
  return toRGBPNG(bw, region.width, region.height);
}

export async function preprocessRedRegion(
  rawRGBA:   Buffer,
  srcWidth:  number,
  srcHeight: number,
  region:    Region
): Promise<PreprocessResult> {
  const cropped = await sharp(rawRGBA, {
    raw: { width: srcWidth, height: srcHeight, channels: 4 },
  })
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .raw()
    .toBuffer();

  const bw = applyRedFilter(cropped, region.width, region.height);
  return toRGBPNG(bw, region.width, region.height);
}

function applyBlueFilter(raw: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = raw[i * 4 + 0];
    const g = raw[i * 4 + 1];
    const b = raw[i * 4 + 2];
    out[i] = (b > 180 && b > r + 20 && b > g + 20) ? 255 : 0;
  }
  return out;
}

function applyRedFilter(raw: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = raw[i * 4 + 0];
    const g = raw[i * 4 + 1];
    const b = raw[i * 4 + 2];
    out[i] = (r > 180 && r > g + 20 && r > b + 20) ? 255 : 0;
  }
  return out;
}

async function toRGBPNG(bw: Buffer, w: number, h: number): Promise<PreprocessResult> {
  const pw = w + 8;
  const ph = h + 8;

  // Embed in padded canvas (white background — PaddleOCR expects dark text on light)
  const padded = Buffer.alloc(pw * ph, 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Invert: white pixels (text) become black, black background becomes white
      padded[(y + 4) * pw + (x + 4)] = bw[y * w + x] > 0 ? 0 : 255;
    }
  }

  const png = await sharp(padded, { raw: { width: pw, height: ph, channels: 1 } })
    .resize(pw * SCALE, ph * SCALE, { kernel: 'nearest' })
    .png({ compressionLevel: 0 })
    .toBuffer();

  if (_dump < 6) { fs.writeFileSync(path.join(process.cwd(), `dbg-paddle-${_dump++}.png`), png); }
  const ab = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  return { buffer: ab, width: pw * SCALE, height: ph * SCALE };
}
