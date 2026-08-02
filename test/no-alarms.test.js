import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

describe('Chrome alarms-free timeout lifecycle', () => {
  it('does not request the alarms permission', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'manifest.json'), 'utf8'));

    expect(manifest.permissions).not.toContain('alarms');
  });

  it('does not use the Chrome alarm API from the background service worker', () => {
    const backgroundSource = readFileSync(join(repoRoot, 'background.js'), 'utf8');

    expect(backgroundSource).not.toContain(`chrome.${'alarms'}`);
    expect(backgroundSource).not.toContain(`HOST_EXPIRY_${'ALARM'}_NAME`);
  });

  it('keeps an in-memory active-host expiry timer', () => {
    const backgroundSource = readFileSync(join(repoRoot, 'background.js'), 'utf8');

    expect(backgroundSource).toContain('hostExpiryTimer = setTimeout');
    expect(backgroundSource).toContain("enforceHostExpiry('timeout')");
  });
});
