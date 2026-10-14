import fs from 'fs';
import path from 'path';
import os from 'os';

// We test the config module by pointing it at a temp directory
// The module uses process.cwd() so we mock the relevant functions directly.

describe('config load/save roundtrip', () => {
  let tmpDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lol-gold-test-'));
    originalCwd = process.cwd;
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Clear module cache so loadConfig re-evaluates CONFIG_PATH
    jest.resetModules();
  });

  test('creates config.json with defaults on first load', async () => {
    const { loadConfig } = await import('../src/config/config');
    const config = loadConfig();

    expect(config.processName).toBe('League Of Legends');
    expect(config.autoStart).toBe(false);
    expect(config.autoStop).toBe(true);
    expect(config.activeGameUUID).toBeNull();
    expect(config.regions.blueGold).toEqual({ x: 798, y: 17, width: 60, height: 20 });
    expect(config.regions.redGold).toEqual({ x: 1103, y: 18, width: 60, height: 20 });

    const filePath = path.join(tmpDir, 'config.json');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('persists and reloads values correctly', async () => {
    const { loadConfig, saveConfig } = await import('../src/config/config');
    const config = loadConfig();

    config.processName = 'TestProcess';
    config.autoStart   = true;
    saveConfig(config);

    jest.resetModules();
    process.cwd = () => tmpDir;

    const { loadConfig: loadConfig2 } = await import('../src/config/config');
    const reloaded = loadConfig2();

    expect(reloaded.processName).toBe('TestProcess');
    expect(reloaded.autoStart).toBe(true);
  });

  test('patchConfig merges nested regions correctly', async () => {
    const { loadConfig, patchConfig } = await import('../src/config/config');
    loadConfig(); // create defaults

    const patched = patchConfig({
      regions: { blueGold: { x: 900 } } as unknown as Record<string, unknown>,
    });

    expect(patched.regions.blueGold.x).toBe(900);
    expect(patched.regions.blueGold.y).toBe(17);       // unchanged
    expect(patched.regions.blueGold.width).toBe(60);   // unchanged
    expect(patched.regions.redGold.x).toBe(1103);      // untouched
  });

  test('falls back to defaults on corrupt config.json', async () => {
    const filePath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(filePath, '{ invalid json !!', 'utf-8');

    const { loadConfig } = await import('../src/config/config');
    const config = loadConfig();
    expect(config.processName).toBe('League Of Legends');
  });
});
