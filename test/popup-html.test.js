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
