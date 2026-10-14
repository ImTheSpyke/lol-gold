export interface CaptureResult {
  rawRGBA: Buffer;
  width:   number;
  height:  number;
}

let screenshotsUnavailable = false;

export async function captureWindowRegion(processName: string): Promise<CaptureResult | null> {
  let Window: typeof import('node-screenshots').Window;
  try {
    ({ Window } = await import('node-screenshots'));
  } catch (err) {
    if (!screenshotsUnavailable) {
      screenshotsUnavailable = true;
      console.warn('[Capture] node-screenshots not available (Windows-only) — OCR capture disabled');
    }
    return null;
  }

  const windows = Window.all();
  const search  = processName.toLowerCase();

  const target = windows.find(w => {
    try {
      const name  = w.appName().toLowerCase();
      const title = w.title().toLowerCase();
      return name.includes(search) || title.includes(search);
    } catch {
      return false;
    }
  });

  if (!target) {
    return null;
  }

  try {
    const image   = await target.captureImage();
    const rawRGBA = await image.toRaw();
    return {
      rawRGBA,
      width:  image.width,
      height: image.height,
    };
  } catch (err) {
    console.error('[Capture] captureImage failed:', (err as Error).message);
    return null;
  }
}
