// Headless Chromium for real rendering (captures, sample art, browser tests).
// Uses Playwright's own Chromium when installed, otherwise an installed Google Chrome.
import { CatalogError } from './core/util.mjs';

const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export async function launchBrowser() {
  const { chromium } = await import('playwright');
  const channel = process.env.CATALOG_BROWSER_CHANNEL;
  const attempts = channel ? [{ channel }] : [{}, { channel: 'chrome' }];
  const errors = [];
  for (const opts of attempts) {
    try { return await chromium.launch({ ...opts, args: ARGS }); } catch (e) { errors.push(e.message.split('\n')[0]); }
  }
  throw new CatalogError('unavailable', `no headless browser available for rendering (${errors.join('; ')}). Install one with: npx --prefix tools/jam/catalog playwright install chromium`);
}
