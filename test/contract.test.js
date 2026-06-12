'use strict';

// Contract tests against the shared mock server.
// Spec: https://github.com/prerender/integration-contract
// In CI the workflow downloads mock-server.mjs to the repo root before
// running tests. Locally:
//   curl -fsSL -o mock-server.mjs https://raw.githubusercontent.com/prerender/integration-contract/main/mock-server.mjs

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const Hapi = require('@hapi/hapi');
const plugin = require('../index');

const MOCK_PORT = process.env.MOCK_PORT || '19091';
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
const MOCK_PATH = process.env.MOCK_SERVER_PATH || path.join(__dirname, '..', 'mock-server.mjs');
const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1)';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const TOKEN = 'test-token-abc123';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let mockProc;

async function waitForMock() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${MOCK_URL}/__health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`mock server at ${MOCK_URL} did not become ready`);
}

async function getRecorded() {
  const res = await fetch(`${MOCK_URL}/__requests`);
  return res.json();
}

async function createServer(options = {}) {
  const server = Hapi.server({ host: 'localhost', port: 0 });
  await server.register({ plugin, options: { serviceUrl: `${MOCK_URL}/`, token: TOKEN, ...options } });
  server.route({ method: 'GET', path: '/', handler: () => 'original' });
  server.route({ method: 'GET', path: '/styles.css', handler: () => 'body{}' });
  server.route({ method: 'GET', path: '/fonts/inter.woff2', handler: () => 'font-bytes' });
  server.route({ method: 'GET', path: '/STYLES.CSS', handler: () => 'BODY{}' });
  server.route({ method: 'GET', path: '/blog/{slug}', handler: () => 'original' });
  await server.initialize();
  return server;
}

before(async () => {
  if (!fs.existsSync(MOCK_PATH)) {
    throw new Error(
      `mock-server.mjs not found at ${MOCK_PATH}. ` +
      'Run: curl -fsSL -o mock-server.mjs https://raw.githubusercontent.com/prerender/integration-contract/main/mock-server.mjs'
    );
  }
  mockProc = spawn('node', [MOCK_PATH], {
    env: { ...process.env, PORT: MOCK_PORT },
    stdio: 'pipe',
  });
  await waitForMock();
});

after(() => {
  if (mockProc) mockProc.kill('SIGTERM');
});

beforeEach(async () => {
  await fetch(`${MOCK_URL}/__reset`, { method: 'POST' });
});

test('bot request emits exactly one outgoing request with required headers', async () => {
  const server = await createServer();
  await server.inject({ method: 'GET', url: '/blog/post-1?ref=twitter', headers: { 'user-agent': BOT_UA } });

  const recorded = await getRecorded();
  assert.equal(recorded.length, 1, 'exactly one request should reach the prerender service');
  const [r] = recorded;
  assert.equal(r.method, 'GET');
  assert.ok(r.url.endsWith('/blog/post-1?ref=twitter'),
    `expected url to end with /blog/post-1?ref=twitter, got ${r.url}`);
  assert.equal(r.headers['user-agent'], BOT_UA);
  assert.equal(r.headers['x-prerender-token'], TOKEN);
  assert.equal(r.headers['x-prerender-int-type'], 'Hapi');
  assert.ok(r.headers['x-prerender-int-version'], 'X-Prerender-Int-Version must be present');
  assert.match(r.headers['x-prerender-int-version'], /^\d+\.\d+\.\d+/);
  assert.match(r.headers['x-prerender-request-id'], UUID_V4);
});

test('browser request emits no outgoing request', async () => {
  const server = await createServer();
  await server.inject({ method: 'GET', url: '/', headers: { 'user-agent': BROWSER_UA } });

  const recorded = await getRecorded();
  assert.equal(recorded.length, 0);
});

test('static asset with bot UA emits no outgoing request', async () => {
  const server = await createServer();
  await server.inject({ method: 'GET', url: '/styles.css', headers: { 'user-agent': BOT_UA } });

  const recorded = await getRecorded();
  assert.equal(recorded.length, 0);
});

test('font asset with bot UA emits no outgoing request', async () => {
  const server = await createServer();
  await server.inject({ method: 'GET', url: '/fonts/inter.woff2', headers: { 'user-agent': BOT_UA } });

  const recorded = await getRecorded();
  assert.equal(recorded.length, 0);
});

test('uppercase static asset with bot UA emits no outgoing request', async () => {
  const server = await createServer();
  await server.inject({ method: 'GET', url: '/STYLES.CSS', headers: { 'user-agent': BOT_UA } });

  const recorded = await getRecorded();
  assert.equal(recorded.length, 0);
});

test('X-Prerender-Token header is omitted when token is not configured', async () => {
  const server = await createServer({ token: null });
  await server.inject({ method: 'GET', url: '/', headers: { 'user-agent': BOT_UA } });

  const recorded = await getRecorded();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].headers['x-prerender-token'], undefined);
});

test('_escaped_fragment_ query triggers prerender for browser UA', async () => {
  const server = await createServer();
  await server.inject({ method: 'GET', url: '/?_escaped_fragment_=', headers: { 'user-agent': BROWSER_UA } });

  const recorded = await getRecorded();
  assert.equal(recorded.length, 1);
  assert.ok(recorded[0].url.includes('_escaped_fragment_'));
});

test('X-Bufferbot header triggers prerender for browser UA', async () => {
  const server = await createServer();
  await server.inject({ method: 'GET', url: '/', headers: { 'user-agent': BROWSER_UA, 'x-bufferbot': 'true' } });

  const recorded = await getRecorded();
  assert.equal(recorded.length, 1);
});

test('X-Prerender-Request-Id is unique per outgoing request', async () => {
  const server = await createServer();
  await server.inject({ method: 'GET', url: '/', headers: { 'user-agent': BOT_UA } });
  await server.inject({ method: 'GET', url: '/', headers: { 'user-agent': BOT_UA } });

  const recorded = await getRecorded();
  assert.equal(recorded.length, 2);
  assert.notEqual(
    recorded[0].headers['x-prerender-request-id'],
    recorded[1].headers['x-prerender-request-id'],
  );
});
