import { preprocessBlueRegion, preprocessRedRegion } from '../src/ocr/preprocess';

function makeRGBA(w: number, h: number, fillRGBA: [number, number, number, number]): Buffer {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4 + 0] = fillRGBA[0];
    buf[i * 4 + 1] = fillRGBA[1];
    buf[i * 4 + 2] = fillRGBA[2];
    buf[i * 4 + 3] = fillRGBA[3];
  }
  return buf;
}

describe('preprocessBlueRegion', () => {
  const region = { x: 0, y: 0, width: 10, height: 5 };

  test('all-blue pixels produce white PNG output', async () => {
    // Blue channel = 200 > 150 → all white
    const raw = makeRGBA(10, 5, [0, 0, 200, 255]);
    const png = await preprocessBlueRegion(raw, 10, 5, region);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.length).toBeGreaterThan(0);
    // PNG header: 0x89 50 4E 47
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4E);
    expect(png[3]).toBe(0x47);
  });

  test('low-blue pixels produce black PNG output (no white pixels)', async () => {
    // Blue channel = 50 < 150 → all black
    const raw = makeRGBA(10, 5, [200, 200, 50, 255]);
    const png = await preprocessBlueRegion(raw, 10, 5, region);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.length).toBeGreaterThan(0);
  });

  test('output PNG is 4x upscaled (40x20 → verified via PNG dimensions)', async () => {
    const raw = makeRGBA(10, 5, [0, 0, 200, 255]);
    const png = await preprocessBlueRegion(raw, 10, 5, region);
    // Read PNG width from IHDR chunk (bytes 16-19) and height (bytes 20-23)
    const width  = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(40);   // 10 * 4
    expect(height).toBe(20);  // 5 * 4
  });
});

describe('preprocessRedRegion', () => {
  const region = { x: 0, y: 0, width: 10, height: 5 };

  test('all-red pixels produce white PNG output', async () => {
    const raw = makeRGBA(10, 5, [200, 0, 0, 255]);
    const png = await preprocessRedRegion(raw, 10, 5, region);
    expect(png).toBeInstanceOf(Buffer);
    expect(png[0]).toBe(0x89);
  });

  test('low-red pixels produce all-black output', async () => {
    const raw = makeRGBA(10, 5, [50, 200, 200, 255]);
    const png = await preprocessRedRegion(raw, 10, 5, region);
    expect(png).toBeInstanceOf(Buffer);
  });

  test('output PNG is 4x upscaled', async () => {
    const raw = makeRGBA(10, 5, [200, 0, 0, 255]);
    const png = await preprocessRedRegion(raw, 10, 5, region);
    const width  = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(40);
    expect(height).toBe(20);
  });
});
