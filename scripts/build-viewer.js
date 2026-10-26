#!/usr/bin/env node
// Build a single self-contained BrowserLink viewer HTML file.
// Usage: node scripts/build-viewer.js
// Output: dist/browserlink-viewer.html
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// The viewer entrypoint — NOT client/index.html, which is the landing page.
const ENTRY = path.join(ROOT, 'client', 'viewer', 'index.html');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'browserlink-viewer.html');

// A literal </script> anywhere inside inlined JS would close the wrapping
// <script> tag early and corrupt the document. Splitting the sequence is
// the standard escape and is inert inside a JS string or regex literal.
function escapeClosingScriptTag(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

function inlineScripts(html, baseDir) {
  return html.replace(
    /<script\b[^>]*?\ssrc="([^"]+)"[^>]*>\s*<\/script>/g,
    (match, src) => {
      if (/^(https?:)?\/\//.test(src)) {
        throw new Error(`External script must be vendored before inlining: ${src}`);
      }
      const filePath = path.resolve(baseDir, src);
      const code = fs.readFileSync(filePath, 'utf8');
      return `<script>\n${escapeClosingScriptTag(code)}\n</script>`;
    }
  );
}

function inlineStylesheets(html, baseDir) {
  return html.replace(
    /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
    (match, href) => {
      if (/^(https?:)?\/\//.test(href)) {
        throw new Error(`External stylesheet must be vendored before inlining: ${href}`);
      }
      const filePath = path.resolve(baseDir, href);
      const css = fs.readFileSync(filePath, 'utf8');
      return `<style>\n${css}\n</style>`;
    }
  );
}

function main() {
  let html = fs.readFileSync(ENTRY, 'utf8');
  html = inlineScripts(html, path.dirname(ENTRY));
  html = inlineStylesheets(html, path.dirname(ENTRY));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html);
  const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} (${kb} KB)`);
}

main();
