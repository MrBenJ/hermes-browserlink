#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const logDir = path.resolve(process.env.LOG_DIR || path.join(__dirname, '..', 'logs'));
const logFile = path.resolve(process.env.LOG_FILE || path.join(logDir, 'lobsterlink-debug.jsonl'));

fs.mkdirSync(logDir, { recursive: true });

function writeJsonLine(record) {
  fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`, 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, logFile });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/log') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  try {
    const rawBody = await parseBody(req);
    const body = rawBody ? JSON.parse(rawBody) : {};
    const record = {
      receivedAt: new Date().toISOString(),
      remoteAddress: req.socket.remoteAddress || '',
      userAgent: req.headers['user-agent'] || '',
      ...body
    };
    writeJsonLine(record);
    sendJson(res, 202, { ok: true });
  } catch (error) {
    const failure = {
      receivedAt: new Date().toISOString(),
      parseError: error.message,
      remoteAddress: req.socket.remoteAddress || ''
    };
    writeJsonLine({ type: 'log_server_error', ...failure });
    sendJson(res, 400, { error: 'Invalid JSON payload' });
  }
});

server.listen(port, host, () => {
  console.log(`LobsterLink log server listening on http://${host}:${port}`);
  console.log(`Writing logs to ${logFile}`);
});
