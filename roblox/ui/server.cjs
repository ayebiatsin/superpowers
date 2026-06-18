'use strict';
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ========== WebSocket Protocol (RFC 6455) ==========

const OPCODES = { TEXT: 0x01, CLOSE: 0x08, PING: 0x09, PONG: 0x0A };
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function computeAcceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + WS_MAGIC).digest('base64');
}

function encodeFrame(opcode, payload) {
  const fin = 0x80;
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = fin | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = fin | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = fin | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const secondByte = buffer[1];
  const opcode = buffer[0] & 0x0F;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7F;
  let offset = 2;
  if (!masked) throw new Error('Client frames must be masked');
  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const maskOffset = offset;
  const dataOffset = offset + 4;
  const totalLen = dataOffset + payloadLen;
  if (buffer.length < totalLen) return null;
  const mask = buffer.slice(maskOffset, dataOffset);
  const data = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) {
    data[i] = buffer[dataOffset + i] ^ mask[i % 4];
  }
  return { opcode, payload: data, bytesConsumed: totalLen };
}

// ========== Configuration ==========

const PORT = process.env.STUDIO_PORT || (49152 + Math.floor(Math.random() * 16383));
const HOST = process.env.STUDIO_HOST || '127.0.0.1';
const URL_HOST = process.env.STUDIO_URL_HOST || (HOST === '127.0.0.1' ? 'localhost' : HOST);
const PROJECT_DIR = process.env.STUDIO_PROJECT_DIR || process.cwd();
const STATE_DIR = process.env.STUDIO_STATE_DIR || path.join(PROJECT_DIR, '.superpowers', 'studio');
let ownerPid = process.env.STUDIO_OWNER_PID ? Number(process.env.STUDIO_OWNER_PID) : null;

const HANDOFF_FILES = [
  'systems.md',
  'feature-spec.md',
  'build-complete.md',
  'qa-report.md',
  'devex-report.md',
  'spec-question.md',
];

// ========== Pipeline State ==========

function fileInfo(name) {
  const fp = path.join(PROJECT_DIR, name);
  try {
    const stat = fs.statSync(fp);
    return { exists: true, mtime: stat.mtime.toISOString(), size: stat.size };
  } catch {
    return null;
  }
}

function parseQAFindings(content) {
  const critical = (content.match(/severity:\s*critical/gi) || []).length;
  const important = (content.match(/severity:\s*important/gi) || []).length;
  const minor = (content.match(/severity:\s*minor/gi) || []).length;
  const passes = (content.match(/\|\s*PASS\s*\|/g) || []).length;
  const fails = (content.match(/\|\s*FAIL\s*\|/g) || []).length;
  return { critical, important, minor, passes, fails };
}

function loadGateStatus() {
  const gateFile = path.join(STATE_DIR, 'gate-status.json');
  try { return JSON.parse(fs.readFileSync(gateFile, 'utf-8')); } catch { return null; }
}

function computePipelineState() {
  const files = {};
  for (const name of HANDOFF_FILES) {
    files[name] = fileInfo(name);
  }
  const gateStatus = loadGateStatus();

  if (files['spec-question.md']) {
    return { phase: 'blocked', description: 'Build agent has a spec question — route to design agent', files, gateStatus };
  }

  const hasSpec = !!files['feature-spec.md'];
  const hasBuild = !!files['build-complete.md'];
  const hasQA = !!files['qa-report.md'];

  if (!hasSpec) {
    return { phase: 'design', description: 'Design agent producing feature-spec.md', files, gateStatus };
  }
  if (!hasBuild) {
    return { phase: 'build', description: 'Build agent implementing feature-spec.md', files, gateStatus };
  }
  if (!hasQA) {
    return { phase: 'qa', description: 'QA agent testing build-complete.md', files, gateStatus };
  }

  const qaContent = fs.readFileSync(path.join(PROJECT_DIR, 'qa-report.md'), 'utf-8');
  const findings = parseQAFindings(qaContent);

  if (findings.critical > 0 || findings.important > 0) {
    return {
      phase: 'balance-loop',
      description: `QA: ${findings.critical} Critical, ${findings.important} Important findings`,
      findings, files, gateStatus,
    };
  }

  return {
    phase: 'ready',
    description: 'All quality gates passed — ready for release',
    findings, files, gateStatus,
  };
}

// ========== HTTP Handler ==========

const dashboardHtml = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf-8');

function handleRequest(req, res) {
  touchActivity();
  const url = new URL(req.url, `http://${HOST}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardHtml);

  } else if (req.method === 'GET' && url.pathname === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(computePipelineState()));

  } else if (req.method === 'GET' && url.pathname.startsWith('/file/')) {
    const name = path.basename(url.pathname.slice(6));
    if (!HANDOFF_FILES.includes(name)) { res.writeHead(403); res.end('Forbidden'); return; }
    const fp = path.join(PROJECT_DIR, name);
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end('File not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(fs.readFileSync(fp, 'utf-8'));

  } else if (req.method === 'POST' && url.pathname === '/action') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const action = JSON.parse(body);
        handleHumanAction(action);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        broadcast({ type: 'state-changed' });
      } catch { res.writeHead(400); res.end('Bad request'); }
    });

  } else {
    res.writeHead(404); res.end('Not found');
  }
}

function handleHumanAction(action) {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  const entry = { ...action, timestamp: new Date().toISOString() };
  fs.appendFileSync(path.join(STATE_DIR, 'decisions.jsonl'), JSON.stringify(entry) + '\n');
  fs.writeFileSync(
    path.join(STATE_DIR, 'gate-status.json'),
    JSON.stringify({ decision: action.decision, phase: action.phase, feedback: action.feedback || null, timestamp: entry.timestamp }, null, 2) + '\n'
  );
  console.log(JSON.stringify({ source: 'human-action', ...entry }));
}

// ========== WebSocket ==========

const clients = new Set();

function handleUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + computeAcceptKey(key) + '\r\n\r\n'
  );
  let buffer = Buffer.alloc(0);
  clients.add(socket);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      let result;
      try { result = decodeFrame(buffer); } catch {
        socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
        clients.delete(socket); return;
      }
      if (!result) break;
      buffer = buffer.slice(result.bytesConsumed);
      if (result.opcode === OPCODES.CLOSE) {
        socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
        clients.delete(socket); return;
      } else if (result.opcode === OPCODES.PING) {
        socket.write(encodeFrame(OPCODES.PONG, result.payload));
      }
    }
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

function broadcast(msg) {
  const frame = encodeFrame(OPCODES.TEXT, Buffer.from(JSON.stringify(msg)));
  for (const socket of clients) {
    try { socket.write(frame); } catch { clients.delete(socket); }
  }
}

// ========== Activity Tracking ==========

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
let lastActivity = Date.now();
function touchActivity() { lastActivity = Date.now(); }

// ========== Server Startup ==========

function startServer() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

  const server = http.createServer(handleRequest);
  server.on('upgrade', handleUpgrade);

  const debounceTimers = new Map();
  const watcher = fs.watch(PROJECT_DIR, (eventType, filename) => {
    if (!filename || !HANDOFF_FILES.includes(filename)) return;
    if (debounceTimers.has(filename)) clearTimeout(debounceTimers.get(filename));
    debounceTimers.set(filename, setTimeout(() => {
      debounceTimers.delete(filename);
      touchActivity();
      console.log(JSON.stringify({ type: 'file-changed', file: filename }));
      broadcast({ type: 'state-changed', file: filename });
    }, 100));
  });
  watcher.on('error', (err) => console.error('fs.watch error:', err.message));

  function ownerAlive() {
    if (!ownerPid) return true;
    try { process.kill(ownerPid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  }

  function shutdown(reason) {
    console.log(JSON.stringify({ type: 'server-stopped', reason }));
    const infoFile = path.join(STATE_DIR, 'server-info');
    if (fs.existsSync(infoFile)) fs.unlinkSync(infoFile);
    watcher.close();
    clearInterval(lifecycleCheck);
    server.close(() => process.exit(0));
  }

  const lifecycleCheck = setInterval(() => {
    if (!ownerAlive()) shutdown('owner process exited');
    else if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) shutdown('idle timeout');
  }, 60 * 1000);
  lifecycleCheck.unref();

  if (ownerPid) {
    try { process.kill(ownerPid, 0); }
    catch (e) {
      if (e.code !== 'EPERM') {
        console.log(JSON.stringify({ type: 'owner-pid-invalid', pid: ownerPid }));
        ownerPid = null;
      }
    }
  }

  server.listen(PORT, HOST, () => {
    const info = JSON.stringify({
      type: 'server-started', port: Number(PORT), host: HOST,
      url_host: URL_HOST, url: `http://${URL_HOST}:${PORT}`,
      project_dir: PROJECT_DIR, state_dir: STATE_DIR,
    });
    console.log(info);
    fs.writeFileSync(path.join(STATE_DIR, 'server-info'), info + '\n');
  });
}

if (require.main === module) startServer();
module.exports = { computeAcceptKey, encodeFrame, decodeFrame, OPCODES };
