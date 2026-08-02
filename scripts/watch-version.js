#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { stampVersion } = require('./stamp-version');

const rootDir = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['.git', 'logs', 'node_modules']);
const ignoredFiles = new Set(['manifest.json']);
const watchers = new Map();

let debounceTimer = null;

function shouldIgnorePath(targetPath) {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith('..')) return true;
  if (relative === '') return false;

  const parts = relative.split(path.sep);
  if (parts.some((part) => ignoredDirs.has(part))) return true;
  if (ignoredFiles.has(parts[parts.length - 1])) return true;
  return false;
}

function scheduleStamp(reasonPath) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      stampVersion();
    } catch (error) {
      console.error('failed to stamp manifest version:', error.message);
    }
  }, 150);
}

function watchDirectory(dirPath) {
  if (watchers.has(dirPath) || shouldIgnorePath(dirPath)) return;

  let watcher;
  try {
    watcher = fs.watch(dirPath, (eventType, filename) => {
      if (!filename) return;
      const changedPath = path.join(dirPath, filename.toString());
      if (shouldIgnorePath(changedPath)) return;

      fs.promises.stat(changedPath).then((stats) => {
        if (stats.isDirectory()) watchDirectory(changedPath);
      }).catch(() => {});

      scheduleStamp(changedPath);
    });
  } catch (error) {
    console.error(`failed to watch ${dirPath}:`, error.message);
    return;
  }

  watchers.set(dirPath, watcher);

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const childPath = path.join(dirPath, entry.name);
    if (shouldIgnorePath(childPath)) continue;
    watchDirectory(childPath);
  }
}

stampVersion();
watchDirectory(rootDir);

console.log(`Watching ${rootDir} for changes...`);

process.on('SIGINT', () => {
  for (const watcher of watchers.values()) watcher.close();
  process.exit(0);
});
