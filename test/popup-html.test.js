import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

describe('popup html metadata', () => {
  it('declares UTF-8 before rendered content', () => {
    const popupHtml = readFileSync(join(repoRoot, 'popup.html'), 'utf8');

    expect(popupHtml).toMatch(/<head>\s*<meta\s+charset=["']utf-8["']>/i);
  });
});

describe('UI pages share the capturable-tab policy', () => {
  const read = (name) => readFileSync(join(repoRoot, name), 'utf8');

  for (const [page, script] of [['bridge.html', 'bridge.js'], ['popup.html', 'popup.js']]) {
    it(`${page} loads lib/background-utils.js before ${script}`, () => {
      const html = read(page);
      const helperAt = html.indexOf('lib/background-utils.js');
      const scriptAt = html.indexOf(`src="${script}"`);
      expect(helperAt).toBeGreaterThan(-1);
      expect(scriptAt).toBeGreaterThan(-1);
      expect(helperAt).toBeLessThan(scriptAt);
    });

    it(`${script} does not define its own isForbiddenTab`, () => {
      // A second copy silently drifts from the service worker's policy — that
      // is how file:// and devtools:// ended up listable in the UI.
      expect(read(script)).not.toMatch(/function\s+isForbiddenTab/);
    });
  }
});
