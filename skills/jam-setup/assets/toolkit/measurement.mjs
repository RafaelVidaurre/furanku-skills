import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function measureFiles(files) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./measure.mjs', import.meta.url)), ...files], { encoding: 'utf8', timeout: 60000, maxBuffer: 1048576, shell: false, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`measurement unavailable: ${result.error?.code ?? result.stderr.trim()}. Check npm ci --prefix tools/jam; no substitute measurements were used.`);
  return JSON.parse(result.stdout);
}
