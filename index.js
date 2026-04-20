'use strict';

const internals = {};

internals.crawlerUserAgents = [
  'googlebot', 'yahoo', 'bingbot', 'baiduspider', 'facebot',
  'facebookexternalhit', 'twitterbot', 'rogerbot', 'linkedinbot',
  'embedly', 'quora link preview', 'showyoubot', 'outbrain',
  'pinterest', 'slackbot', 'developers.google.com/+/web/snippet',
  'w3c_validator', 'perplexity', 'oai-searchbot', 'chatgpt-user',
  'gptbot', 'claudebot', 'amazonbot'
];

internals.extensionsToIgnore = [
  '.js', '.css', '.xml', '.less', '.png', '.jpg', '.jpeg', '.gif',
  '.pdf', '.doc', '.txt', '.ico', '.rss', '.zip', '.mp3', '.rar',
  '.exe', '.wmv', '.avi', '.ppt', '.mpg', '.mpeg', '.tif', '.wav',
  '.mov', '.psd', '.ai', '.xls', '.mp4', '.m4a', '.swf', '.dat',
  '.dmg', '.iso', '.flv', '.m4v', '.torrent', '.ttf', '.woff', '.svg'
];

internals.defaults = {
  serviceUrl: process.env.PRERENDER_SERVICE_URL || 'https://service.prerender.io/',
  token: process.env.PRERENDER_TOKEN || null,
  protocol: null,
  beforeRender: async () => null,
  afterRender: () => {}
};

function isBot(userAgent) {
  const ua = userAgent.toLowerCase();
  return internals.crawlerUserAgents.some((bot) => ua.includes(bot));
}

function isStaticAsset(pathname) {
  return internals.extensionsToIgnore.some((ext) => pathname.endsWith(ext));
}

function shouldPrerender(request) {
  const userAgent = request.headers['user-agent'];
  if (!userAgent || request.method !== 'get') return false;

  const { pathname, searchParams } = request.url;
  if (isStaticAsset(pathname)) return false;

  return searchParams.has('_escaped_fragment_')
    || isBot(userAgent)
    || !!request.headers['x-bufferbot'];
}

function buildApiUrl(request, settings) {
  const protocol = settings.protocol || request.server.info.protocol;
  const base = settings.serviceUrl.endsWith('/')
    ? settings.serviceUrl
    : settings.serviceUrl + '/';
  const { pathname, search } = request.url;
  return `${base}${protocol}://${request.headers.host}${pathname}${search}`;
}

async function fetchPrerendered(apiUrl, request, settings) {
  const headers = { 'User-Agent': request.headers['user-agent'] };
  if (settings.token) {
    headers['X-Prerender-Token'] = settings.token;
  }
  const response = await fetch(apiUrl, { headers, redirect: 'manual' });
  const body = await response.text();
  return { status: response.status, headers: response.headers, body };
}

function buildResponse(h, prerendered) {
  const response = h.response(prerendered.body).code(prerendered.status).takeover();
  for (const [key, value] of prerendered.headers.entries()) {
    response.header(key, value);
  }
  return response;
}

exports.plugin = {
  pkg: require('./package.json'),
  async register(server, options) {
    const settings = { ...internals.defaults, ...options };

    server.ext('onRequest', async (request, h) => {
      if (!shouldPrerender(request)) return h.continue;

      const cached = await settings.beforeRender(request);
      if (cached) return buildResponse(h, cached);

      try {
        const apiUrl = buildApiUrl(request, settings);
        const prerendered = await fetchPrerendered(apiUrl, request, settings);
        settings.afterRender(request, prerendered);
        return buildResponse(h, prerendered);
      } catch (err) {
        console.error('Prerender error, falling back:', err.message);
        return h.continue;
      }
    });
  }
};
