import path from 'path';

// Resolves the same way from src/server (dev) and dist/server (prod).
export const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

// Chart.js ships its browser UMD bundle in dist/; serve it from node_modules
// rather than vendoring a copy. (Its package "exports" hide subpaths, so
// resolve the main entry and take its directory.)
export const CHARTJS_DIST_DIR = path.dirname(require.resolve('chart.js'));
