#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const manifestPath = path.resolve(__dirname, '..', 'manifest.json');

function getVersion(date = new Date()) {
  return [
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes()
  ].join('.');
}

function stampVersion() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const nextVersion = getVersion();
  const previousVersion = manifest.version;

  if (previousVersion === nextVersion) {
    console.log(`manifest version unchanged: ${nextVersion}`);
    return nextVersion;
  }

  manifest.version = nextVersion;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`manifest version updated: ${previousVersion} -> ${nextVersion}`);
  return nextVersion;
}

if (require.main === module) {
  stampVersion();
}

module.exports = {
  getVersion,
  stampVersion
};
