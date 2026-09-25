// Local server for `npm run dev`. Serves the demo routes on port 8788 with an in-memory quota, so
// only GEMINI_API_KEY is needed. Reads functions/.env if present (KEY=value lines, # comments).
// The Vite dev server proxies /api/demo here.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

// Imported after the env is loaded, because demo.js reads DEMO_* at module load.
const { createDemoApp, memoryQuota } = await import('./demo.js');

const PORT = Number(process.env.PORT || 8788);
const app = createDemoApp({ takeQuota: memoryQuota() });

app.listen(PORT, () => {
  console.log(`[demo] listening on http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY && !process.env.GEMINI_DEMO_API_KEY) {
    console.warn('[demo] GEMINI_API_KEY is not set. Copy .env.example to functions/.env and add a key.');
  }
});
