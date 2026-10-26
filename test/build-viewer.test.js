import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-correct: __dirname does not exist in Vitest/Node ESM test files.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'browserlink-viewer.html');

describe('build-viewer', () => {
  beforeAll(() => {
    execFileSync('node', [path.join(ROOT, 'scripts', 'build-viewer.js')], { stdio: 'pipe' });
  });

  it('produces the output file', () => {
    expect(fs.existsSync(OUT)).toBe(true);
  });

  it('contains no external script references', () => {
    expect(fs.readFileSync(OUT, 'utf8')).not.toMatch(/<script[^>]+\ssrc=/);
  });

  it('contains no external stylesheet links', () => {
    expect(fs.readFileSync(OUT, 'utf8')).not.toMatch(/<link[^>]+rel=["']stylesheet["']/);
  });

  it('inlines substantial JS (peerjs is large)', () => {
    expect(fs.readFileSync(OUT, 'utf8').length).toBeGreaterThan(100000);
  });

  it('is the viewer entry, not the landing page', () => {
    const html = fs.readFileSync(OUT, 'utf8');
    expect(html).toContain('id="remote-video"');
    expect(html).toContain('id="overlay-peer-input"');
  });

  it('contains no lobsterl.ink or other hardcoded viewer domain', () => {
    const html = fs.readFileSync(OUT, 'utf8');
    expect(html).not.toMatch(/lobsterl\.ink/i);
  });
});
