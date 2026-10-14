import sharp from 'sharp';
import type { Region } from '../config/config';

export type Team = 'blue' | 'red';

export interface PreprocessResult {
  buffer: ArrayBuffer;
  width:  number;
  height: number;
}

const SCALE   = 4;
const PADDING = 4;

// Index of the dominant channel in an RGBA pixel for each team's gold text.
const CHANNEL: Record<Team, number> = { blue: 2, red: 0 };

/**
 * Crops `region` out of a raw RGBA frame and turns it into an upscaled,
 * padded, black-on-white PNG suitable for PaddleOCR.
 */
export async function preprocessRegion(
  rawRGBA:   Buffer,
  srcWidth:  number,
  srcHeight: number,
  region:    Region,
  team:      Team
): Promise<PreprocessResult> {
  const cropped = await sharp(rawRGBA, {
    raw: { width: srcWidth, height: srcHeight, channels: 4 },
  })
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .raw()
    .toBuffer();

  const bw = applyChannelFilter(cropped, region.width, region.height, CHANNEL[team]);
  return toPaddedPNG(bw, region.width, region.height);
}

// Keeps pixels whose `channel` is bright and clearly dominant over the other two.
function applyChannelFilter(raw: Buffer, w: number, h: number, channel: number): Buffer {
  const [o1, o2] = [0, 1, 2].filter(c => c !== channel);
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const main = raw[i * 4 + channel];
    out[i] = (main > 180 && main > raw[i * 4 + o1] + 20 && main > raw[i * 4 + o2] + 20) ? 255 : 0;
  }
  return out;
}

async function toPaddedPNG(bw: Buffer, w: number, h: number): Promise<PreprocessResult> {
  const pw = w + PADDING * 2;
  const ph = h + PADDING * 2;

  // Embed in padded canvas (white background — PaddleOCR expects dark text on light)
  const padded = Buffer.alloc(pw * ph, 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Invert: white pixels (text) become black, black background becomes white
      padded[(y + PADDING) * pw + (x + PADDING)] = bw[y * w + x] > 0 ? 0 : 255;
    }
  }

  const png = await sharp(padded, { raw: { width: pw, height: ph, channels: 1 } })
    .resize(pw * SCALE, ph * SCALE, { kernel: 'nearest' })
    .png({ compressionLevel: 0 })
    .toBuffer();

  const ab = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  return { buffer: ab, width: pw * SCALE, height: ph * SCALE };
}
