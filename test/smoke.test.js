'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Hapi = require('@hapi/hapi');

const plugin = require('../index');

const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1)';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const PRERENDERED_HTML = '<html><body>prerendered</body></html>';

const originalFetch = global.fetch;

function mockFetch(status = 200, body = PRERENDERED_HTML) {
  global.fetch = async () => ({
    status,
    headers: new Headers({ 'content-type': 'text/html' }),
    text: async () => body
  });
}

function restoreFetch() {
  global.fetch = originalFetch;
}

async function createServer(options = {}) {
  const server = Hapi.server({ host: 'localhost', port: 3000 });
  await server.register({ plugin, options });
  server.route({ method: 'GET', path: '/', handler: () => 'original' });
  server.route({ method: 'GET', path: '/style.css', handler: () => 'body{}' });
  server.route({ method: 'GET', path: '/fonts/inter.woff2', handler: () => 'font-bytes' });
  server.route({ method: 'GET', path: '/STYLES.CSS', handler: () => 'BODY{}' });
  await server.initialize();
  return server;
}

afterEach(() => {
  restoreFetch();
});

test('plugin registers without error', async () => {
  const server = Hapi.server();
  await assert.doesNotReject(() => server.register(plugin));
});

test('normal browser request passes through to route handler', async () => {
  const server = await createServer({ token: 'test-token' });
  const res = await server.inject({ method: 'GET', url: '/', headers: { 'user-agent': BROWSER_UA } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, 'original');
});

test('bot request receives prerendered response', async () => {
  mockFetch(200, PRERENDERED_HTML);
  const server = await createServer({ token: 'test-token' });
  const res = await server.inject({ method: 'GET', url: '/', headers: { 'user-agent': BOT_UA } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, PRERENDERED_HTML);
});

test('static asset with bot UA is not prerendered', async () => {
  const server = await createServer();
  const res = await server.inject({ method: 'GET', url: '/style.css', headers: { 'user-agent': BOT_UA } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, 'body{}');
});

test('font asset with bot UA is not prerendered', async () => {
  mockFetch(200, PRERENDERED_HTML);
  const server = await createServer();
  const res = await server.inject({ method: 'GET', url: '/fonts/inter.woff2', headers: { 'user-agent': BOT_UA } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, 'font-bytes');
});

test('uppercase static asset with bot UA is not prerendered', async () => {
  mockFetch(200, PRERENDERED_HTML);
  const server = await createServer();
  const res = await server.inject({ method: 'GET', url: '/STYLES.CSS', headers: { 'user-agent': BOT_UA } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, 'BODY{}');
});

test('_escaped_fragment_ query triggers prerender for any user agent', async () => {
  mockFetch(200, PRERENDERED_HTML);
  const server = await createServer({ token: 'test-token' });
  const res = await server.inject({ method: 'GET', url: '/?_escaped_fragment_=', headers: { 'user-agent': BROWSER_UA } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, PRERENDERED_HTML);
});

test('prerender fetch error falls back to normal response', async () => {
  global.fetch = async () => { throw new Error('network error'); };
  const server = await createServer({ token: 'test-token' });
  const res = await server.inject({ method: 'GET', url: '/', headers: { 'user-agent': BOT_UA } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, 'original');
});
