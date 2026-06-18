'use strict';
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SERVER_PATH = path.join(__dirname, '../../roblox/ui/server.cjs');
const TEST_PORT = 3335;
const TEST_DIR = '/tmp/studio-ui-test';
const STATE_DIR = path.join(TEST_DIR, '.superpowers', 'studio');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function post(url, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = http.request(url, opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function startServer() {
  return spawn('node', [SERVER_PATH], {
    env: {
      ...process.env,
      STUDIO_PORT: TEST_PORT,
      STUDIO_PROJECT_DIR: TEST_DIR,
      STUDIO_STATE_DIR: STATE_DIR,
    },
  });
}

async function waitForServer(server) {
  let stdout = '', stderr = '';
  return new Promise((resolve, reject) => {
    server.stdout.on('data', d => {
      stdout += d.toString();
      if (stdout.includes('server-started')) resolve({ stdout });
    });
    server.stderr.on('data', d => { stderr += d.toString(); });
    server.on('error', reject);
    setTimeout(() => reject(new Error(`Server did not start. stderr: ${stderr}`)), 5000);
  });
}

async function runTests() {
  cleanup();
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const server = startServer();
  let stdoutAccum = '';
  server.stdout.on('data', d => { stdoutAccum += d.toString(); });

  const { stdout: startupOutput } = await waitForServer(server);
  let passed = 0, failed = 0;

  const BASE = `http://localhost:${TEST_PORT}`;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (e) {
      console.log(`  FAIL: ${name}`);
      console.log(`    ${e.message}`);
      failed++;
    }
  }

  try {

    // ── Server Startup ──────────────────────────────────────────────────
    console.log('\n--- Server Startup ---');

    await test('outputs server-started JSON with correct fields', () => {
      const msg = JSON.parse(startupOutput.trim().split('\n').find(l => l.includes('server-started')));
      assert.strictEqual(msg.type, 'server-started');
      assert.strictEqual(msg.port, TEST_PORT);
      assert(msg.url, 'should include url');
      assert(msg.project_dir, 'should include project_dir');
      assert(msg.state_dir, 'should include state_dir');
    });

    await test('writes server-info file to state dir', () => {
      const infoPath = path.join(STATE_DIR, 'server-info');
      assert(fs.existsSync(infoPath), 'server-info should exist');
      const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8').trim());
      assert.strictEqual(info.type, 'server-started');
      assert.strictEqual(info.port, TEST_PORT);
    });

    // ── Dashboard HTML ───────────────────────────────────────────────────
    console.log('\n--- Dashboard HTML ---');

    await test('GET / serves the dashboard', async () => {
      const res = await get(`${BASE}/`);
      assert.strictEqual(res.status, 200);
      assert(res.headers['content-type'].includes('text/html'));
      assert(res.body.includes('Game Studio Orchestration'), 'should have dashboard title');
    });

    await test('dashboard includes WebSocket client code', async () => {
      const res = await get(`${BASE}/`);
      assert(res.body.includes('WebSocket'), 'should have WS client');
      assert(res.body.includes('/state'), 'should fetch /state');
    });

    await test('dashboard includes pipeline stepper', async () => {
      const res = await get(`${BASE}/`);
      assert(res.body.includes('stepper'), 'should have stepper element');
    });

    // ── Pipeline State ───────────────────────────────────────────────────
    console.log('\n--- Pipeline State ---');

    await test('GET /state returns design phase when no files exist', async () => {
      const res = await get(`${BASE}/state`);
      assert.strictEqual(res.status, 200);
      const state = JSON.parse(res.body);
      assert.strictEqual(state.phase, 'design');
      assert(state.files, 'should include files map');
      assert.strictEqual(state.files['feature-spec.md'], null);
    });

    await test('phase advances to build when feature-spec.md is written', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'feature-spec.md'), '# Feature Spec\n\n## Acceptance criteria\n1. XP is awarded');
      await sleep(200);
      const res = await get(`${BASE}/state`);
      const state = JSON.parse(res.body);
      assert.strictEqual(state.phase, 'build');
      assert(state.files['feature-spec.md'], 'feature-spec.md should appear in files');
    });

    await test('phase advances to qa when build-complete.md is written', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'build-complete.md'), '# Build Complete\n\nAll done.');
      await sleep(200);
      const state = JSON.parse((await get(`${BASE}/state`)).body);
      assert.strictEqual(state.phase, 'qa');
    });

    await test('phase becomes balance-loop when qa-report has Critical findings', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'qa-report.md'),
        '# QA Report\n\n**1. XP rate**\nSeverity: Critical\nObserved: 500\nExpected: 50-80\n');
      await sleep(200);
      const state = JSON.parse((await get(`${BASE}/state`)).body);
      assert.strictEqual(state.phase, 'balance-loop');
      assert(state.findings.critical >= 1, 'should count Critical findings');
    });

    await test('phase becomes balance-loop when qa-report has Important findings', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'qa-report.md'),
        '# QA Report\n\n**1. Economy**\nSeverity: Important\nObserved: x\nExpected: y\n');
      await sleep(200);
      const state = JSON.parse((await get(`${BASE}/state`)).body);
      assert.strictEqual(state.phase, 'balance-loop');
      assert(state.findings.important >= 1, 'should count Important findings');
    });

    await test('phase becomes ready when qa-report has only Minor or no findings', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'qa-report.md'),
        '# QA Report\n\n| Criterion | Result |\n|-----------|---------|\n| XP awarded | PASS |\n\n**1. Polish**\nSeverity: Minor\n');
      await sleep(200);
      const state = JSON.parse((await get(`${BASE}/state`)).body);
      assert.strictEqual(state.phase, 'ready');
    });

    await test('blocked phase when spec-question.md exists', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'spec-question.md'), '# Spec Question\n\nWhat does "fast" mean?');
      await sleep(200);
      const state = JSON.parse((await get(`${BASE}/state`)).body);
      assert.strictEqual(state.phase, 'blocked');
    });

    await test('files map reflects actual presence of all handoff files', async () => {
      const state = JSON.parse((await get(`${BASE}/state`)).body);
      assert(state.files['feature-spec.md'] !== null, 'feature-spec.md should be present');
      assert(state.files['build-complete.md'] !== null, 'build-complete.md should be present');
      assert(state.files['qa-report.md'] !== null, 'qa-report.md should be present');
      assert(state.files['spec-question.md'] !== null, 'spec-question.md should be present');
      assert.strictEqual(state.files['devex-report.md'], null, 'devex-report.md should be absent');
      assert(state.files['feature-spec.md'].mtime, 'should include mtime');
      assert(state.files['feature-spec.md'].size > 0, 'should include size');
    });

    // ── File Serving ─────────────────────────────────────────────────────
    console.log('\n--- File Serving ---');

    await test('GET /file/feature-spec.md returns file content', async () => {
      const res = await get(`${BASE}/file/feature-spec.md`);
      assert.strictEqual(res.status, 200);
      assert(res.body.includes('Feature Spec'), 'should return file content');
      assert(res.headers['content-type'].includes('text/plain'));
    });

    await test('GET /file/ returns 404 for absent files', async () => {
      const res = await get(`${BASE}/file/devex-report.md`);
      assert.strictEqual(res.status, 404);
    });

    await test('GET /file/ returns 403 for files not in the allowed list', async () => {
      const res = await get(`${BASE}/file/CLAUDE.md`);
      assert.strictEqual(res.status, 403);
    });

    await test('GET /file/ with path traversal is blocked', async () => {
      // URL parser normalizes /file/../CLAUDE.md → /CLAUDE.md, which misses
      // the /file/ guard and hits the 404 handler. File is still not served.
      const res = await get(`${BASE}/file/../CLAUDE.md`);
      assert.notStrictEqual(res.status, 200, 'should not serve traversed file');
    });

    // ── Human Actions ────────────────────────────────────────────────────
    console.log('\n--- Human Actions ---');

    await test('POST /action writes gate-status.json', async () => {
      const res = await post(`${BASE}/action`, { decision: 'approve', phase: 'build', feedback: '' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(JSON.parse(res.body).ok, true);

      const gateFile = path.join(STATE_DIR, 'gate-status.json');
      assert(fs.existsSync(gateFile), 'gate-status.json should exist');
      const gate = JSON.parse(fs.readFileSync(gateFile, 'utf-8'));
      assert.strictEqual(gate.decision, 'approve');
      assert.strictEqual(gate.phase, 'build');
      assert(gate.timestamp, 'should have timestamp');
    });

    await test('POST /action appends to decisions.jsonl audit log', async () => {
      await post(`${BASE}/action`, { decision: 'reject', phase: 'ready', feedback: 'needs more tuning' });
      const logFile = path.join(STATE_DIR, 'decisions.jsonl');
      assert(fs.existsSync(logFile), 'decisions.jsonl should exist');
      const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
      const last = JSON.parse(lines[lines.length - 1]);
      assert.strictEqual(last.decision, 'reject');
      assert.strictEqual(last.feedback, 'needs more tuning');
    });

    await test('POST /action overwrites gate-status with latest decision', async () => {
      await post(`${BASE}/action`, { decision: 'approve', phase: 'ready' });
      const gate = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'gate-status.json'), 'utf-8'));
      assert.strictEqual(gate.decision, 'approve');
      assert.strictEqual(gate.phase, 'ready');
    });

    await test('gate status appears in /state response', async () => {
      const state = JSON.parse((await get(`${BASE}/state`)).body);
      assert(state.gateStatus, 'gateStatus should be in state');
      assert.strictEqual(state.gateStatus.decision, 'approve');
    });

    await test('POST /action returns 400 for malformed JSON', async () => {
      const res = await new Promise((resolve, reject) => {
        const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
        const req = http.request(`${BASE}/action`, opts, res => {
          let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.write('not json');
        req.end();
      });
      assert.strictEqual(res.status, 400);
    });

    // ── WebSocket ────────────────────────────────────────────────────────
    console.log('\n--- WebSocket ---');

    await test('accepts WebSocket connections', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
      ws.close();
    });

    await test('broadcasts state-changed when a handoff file is written', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise(res => ws.on('open', res));

      let gotEvent = false;
      ws.on('message', d => {
        const msg = JSON.parse(d.toString());
        if (msg.type === 'state-changed') gotEvent = true;
      });

      fs.writeFileSync(path.join(TEST_DIR, 'feature-spec.md'), '# Updated spec');
      await sleep(400);

      assert(gotEvent, 'should broadcast state-changed on file write');
      ws.close();
    });

    await test('does NOT broadcast for non-handoff files', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise(res => ws.on('open', res));

      let gotEvent = false;
      ws.on('message', d => {
        const msg = JSON.parse(d.toString());
        if (msg.type === 'state-changed') gotEvent = true;
      });

      fs.writeFileSync(path.join(TEST_DIR, 'random-notes.txt'), 'irrelevant');
      await sleep(400);

      assert(!gotEvent, 'should NOT broadcast for non-handoff files');
      ws.close();
    });

    await test('broadcasts to multiple concurrent clients', async () => {
      const ws1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
      const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await Promise.all([new Promise(r => ws1.on('open', r)), new Promise(r => ws2.on('open', r))]);

      let c1 = false, c2 = false;
      ws1.on('message', d => { if (JSON.parse(d.toString()).type === 'state-changed') c1 = true; });
      ws2.on('message', d => { if (JSON.parse(d.toString()).type === 'state-changed') c2 = true; });

      fs.writeFileSync(path.join(TEST_DIR, 'build-complete.md'), '# Updated build');
      await sleep(400);

      assert(c1, 'client 1 should receive state-changed');
      assert(c2, 'client 2 should receive state-changed');
      ws1.close(); ws2.close();
    });

    await test('POST /action broadcasts state-changed to WebSocket clients', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise(r => ws.on('open', r));

      let gotEvent = false;
      ws.on('message', d => { if (JSON.parse(d.toString()).type === 'state-changed') gotEvent = true; });

      await post(`${BASE}/action`, { decision: 'approve', phase: 'qa' });
      await sleep(300);

      assert(gotEvent, 'POST /action should trigger state-changed broadcast');
      ws.close();
    });

    // ── 404 / Routing ────────────────────────────────────────────────────
    console.log('\n--- Routing ---');

    await test('GET unknown path returns 404', async () => {
      const res = await get(`${BASE}/does-not-exist`);
      assert.strictEqual(res.status, 404);
    });

    // ── Summary ──────────────────────────────────────────────────────────
    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
    if (failed > 0) process.exit(1);

  } finally {
    server.kill();
    await sleep(100);
    cleanup();
  }
}

runTests().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
