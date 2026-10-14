import sharp from 'sharp';
import { preprocessRegion, type Team } from '../src/ocr/preprocess';

const SCALE   = 4;
const PADDING = 4;

function makeRGBA(w: number, h: number, fill: [number, number, number, number]): Buffer {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) buf.set(fill, i * 4);
  return buf;
}

// Decodes the output PNG and returns the grayscale value at the region's center.
async function centerPixel(png: ArrayBuffer, width: number, height: number): Promise<number> {
  const { data, info } = await sharp(Buffer.from(png)).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data[Math.floor(height / 2) * info.width + Math.floor(width / 2)];
}

const region = { x: 0, y: 0, width: 10, height: 5 };

describe.each<[Team, [number, number, number, number], [number, number, number, number]]>([
  ['blue', [0, 0, 220, 255],   [200, 200, 50, 255]],
  ['red',  [220, 0, 0, 255],   [50, 200, 200, 255]],
])('preprocessRegion(%s)', (team, matching, nonMatching) => {
  test('returns a PNG upscaled with padding', async () => {
    const out = await preprocessRegion(makeRGBA(10, 5, matching), 10, 5, region, team);
    const png = Buffer.from(out.buffer);

    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(out.width).toBe((10 + PADDING * 2) * SCALE);
    expect(out.height).toBe((5 + PADDING * 2) * SCALE);
    expect(png.readUInt32BE(16)).toBe(out.width);
    expect(png.readUInt32BE(20)).toBe(out.height);
  });

  test('team-coloured pixels become black text', async () => {
    const out = await preprocessRegion(makeRGBA(10, 5, matching), 10, 5, region, team);
    expect(await centerPixel(out.buffer, out.width, out.height)).toBe(0);
  });

  test('other pixels become white background', async () => {
    const out = await preprocessRegion(makeRGBA(10, 5, nonMatching), 10, 5, region, team);
    expect(await centerPixel(out.buffer, out.width, out.height)).toBe(255);
  });
});
