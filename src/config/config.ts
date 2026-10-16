import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// config.json lives in CONFIG_DIR (defaults to the working directory).
const CONFIG_DIR  = process.env['CONFIG_DIR'] ?? process.cwd();
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const RegionSchema = z.object({
  x:      z.number().int().min(0),
  y:      z.number().int().min(0),
  width:  z.number().int().min(1),
  height: z.number().int().min(1),
});

const DEFAULT_BLUE_REGION = { x: 798,  y: 17, width: 60, height: 20 };
const DEFAULT_RED_REGION  = { x: 1103, y: 18, width: 60, height: 20 };

export const AppConfigSchema = z.object({
  processName:    z.string().default('League Of Legends'),
  activeGameUUID: z.string().uuid().nullable().default(null),
  autoStart:      z.boolean().default(false),
  autoStop:       z.boolean().default(true),
  regions: z.object({
    blueGold: RegionSchema.default(DEFAULT_BLUE_REGION),
    redGold:  RegionSchema.default(DEFAULT_RED_REGION),
  }).default({ blueGold: DEFAULT_BLUE_REGION, redGold: DEFAULT_RED_REGION }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type Region    = z.infer<typeof RegionSchema>;

/** SQLite file; override with DB_PATH. */
export function loadDBPath(): string {
  return process.env['DB_PATH'] ?? path.join(CONFIG_DIR, 'lol-graph.db');
}

function deepMerge<T extends object>(base: T, patch: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const patchVal = patch[key];
    const baseVal  = base[key];
    if (
      patchVal !== null &&
      patchVal !== undefined &&
      typeof patchVal === 'object' &&
      !Array.isArray(patchVal) &&
      typeof baseVal === 'object' &&
      baseVal !== null
    ) {
      result[key] = deepMerge(baseVal as object, patchVal as object) as T[keyof T];
    } else if (patchVal !== undefined) {
      result[key] = patchVal as T[keyof T];
    }
  }
  return result;
}

export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = AppConfigSchema.parse({});
    saveConfig(defaults);
    return defaults;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return AppConfigSchema.parse(raw);
  } catch {
    console.error('[Config] Failed to parse config.json, using defaults');
    const defaults = AppConfigSchema.parse({});
    saveConfig(defaults);
    return defaults;
  }
}

export function saveConfig(config: AppConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Config] Failed to write config.json:', (err as Error).message);
  }
}

export function patchConfig(patch: Record<string, unknown>): AppConfig {
  const current   = loadConfig();
  const merged    = deepMerge(current as Record<string, unknown>, patch) as AppConfig;
  const validated = AppConfigSchema.parse(merged);
  saveConfig(validated);
  return validated;
}
