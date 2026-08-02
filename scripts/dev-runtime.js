#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');

const scriptDir = __dirname;
const children = [];
let shuttingDown = false;

function startChild(label, scriptName) {
  const child = spawn(process.execPath, [path.join(scriptDir, scriptName)], {
    cwd: path.resolve(scriptDir, '..'),
    stdio: ['inherit', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });

  child.on('exit', (code, signal) => {
    const status = signal ? `signal ${signal}` : `code ${code}`;
    process.stderr.write(`[${label}] exited with ${status}\n`);
    if (!shuttingDown) {
      shutdown(code || 1);
    }
  });

  children.push(child);
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  }

  setTimeout(() => process.exit(exitCode), 100);
}

startChild('logger', 'log-server.js');
startChild('version', 'watch-version.js');

console.log('LobsterLink dev runtime started.');
console.log('Running log server and manifest version watcher together.');

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
