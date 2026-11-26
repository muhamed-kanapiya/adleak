// Restores the intentionally broken landing page (demo/template -> demo/site).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, 'site');
fs.rmSync(site, { recursive: true, force: true });
fs.cpSync(path.join(here, 'template'), site, { recursive: true });
console.log('Broken demo landing restored in demo/site');
