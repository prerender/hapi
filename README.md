# prerender-hapi

Hapi plugin for [Prerender.io](https://prerender.io). Intercepts requests from bots and crawlers and serves prerendered HTML, so your JavaScript-rendered app is fully indexable by search engines and social media scrapers.

Compatible with **@hapi/hapi v21+** and **Node.js 18+**.

## Installation

```bash
npm install prerender-hapi
```

## Usage

```javascript
const Hapi = require('@hapi/hapi');

const server = Hapi.server({ host: 'localhost', port: 3000 });

await server.register({
  plugin: require('prerender-hapi'),
  options: {
    token: 'YOUR_PRERENDER_TOKEN'
  }
});
```

The plugin registers an `onRequest` extension that transparently proxies bot requests to Prerender.io and returns the prerendered HTML. Regular browser requests are unaffected.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | `string` | `process.env.PRERENDER_TOKEN` | Your Prerender.io token |
| `serviceUrl` | `string` | `process.env.PRERENDER_SERVICE_URL` or `https://service.prerender.io/` | Prerender service URL (use this for self-hosted Prerender) |
| `protocol` | `string` | `null` | Force a protocol (`http` or `https`). Defaults to the server's protocol |
| `beforeRender` | `async function(request)` | `async () => null` | Called before each prerender request. Return a cached response object `{ status, headers, body }` to skip the Prerender.io call |
| `afterRender` | `function(request, response)` | `() => {}` | Called after a successful prerender. Use this to cache the response |

## Environment variables

```bash
PRERENDER_TOKEN=your_token_here
PRERENDER_SERVICE_URL=https://service.prerender.io/  # optional
```

## Self-hosted Prerender

```javascript
await server.register({
  plugin: require('prerender-hapi'),
  options: {
    serviceUrl: 'http://your-prerender-server:3000'
  }
});
```

## Caching example

```javascript
const cache = new Map();

await server.register({
  plugin: require('prerender-hapi'),
  options: {
    token: 'YOUR_PRERENDER_TOKEN',
    beforeRender: async (request) => {
      return cache.get(request.url.href) || null;
    },
    afterRender: (request, response) => {
      cache.set(request.url.href, response);
    }
  }
});
```

## How it works

Requests are prerendered when **all** of the following are true:

- The HTTP method is `GET`
- The `User-Agent` matches a known bot/crawler (Googlebot, Bingbot, Twitterbot, GPTBot, ClaudeBot, etc.)  
  — OR the URL contains `_escaped_fragment_`  
  — OR the `X-Bufferbot` header is present
- The URL does not end with a static asset extension (`.js`, `.css`, `.png`, etc.)

Everything else passes through to your normal route handlers.

## License

MIT
