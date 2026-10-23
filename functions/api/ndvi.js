// Hull Ag Solutions — Cloudflare Pages Function
// POST /api/ndvi with { bbox: [west,south,east,north], from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
// Returns a transparent PNG, compatible with Leaflet imageOverlay.
const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/process/v1';
let tokenCache = null;
let tokenExpires = 0;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

async function accessToken(env) {
  if (tokenCache && Date.now() < tokenExpires - 60000) return tokenCache;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.SENTINEL_CLIENT_ID,
    client_secret: env.SENTINEL_CLIENT_SECRET
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params
  });
  if (!res.ok) throw new Error('Copernicus authentication failed (' + res.status + '). Check your Cloudflare environment variables.');
  const payload = await res.json();
  if (!payload.access_token) throw new Error('Copernicus did not return an access token.');
  tokenCache = payload.access_token;
  tokenExpires = Date.now() + (Number(payload.expires_in) || 600) * 1000;
  return tokenCache;
}

const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [
  { bands: ["B04", "B08"], units: "REFLECTANCE" },
  { bands: ["SCL"], units: "DN" }
],
    output: { bands: 4, sampleType: 'AUTO' }
  };
}
function evaluatePixel(s) {
  // SCL classes 0,1,3,8,9,10,11: no data, bad, shadows, clouds, cirrus, snow.
  if (!s.dataMask || [0,1,3,8,9,10,11].includes(s.SCL)) return [0,0,0,0];
  var sum = s.B08 + s.B04;
  if (sum <= 0) return [0,0,0,0];
  var v = (s.B08 - s.B04) / sum;
  // Red -> orange -> yellow -> light green -> dark green
  var stops = [
    [-1, [0.647,0,0.149]],
    [0, [0.957,0.427,0.263]],
    [0.2, [0.996,0.878,0.545]],
    [0.4, [0.651,0.835,0.396]],
    [0.6, [0.102,0.596,0.314]],
    [1, [0,0.408,0.216]]
  ];
  for (var i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      var t = Math.max(0, Math.min(1, (v - stops[i-1][0]) / (stops[i][0] - stops[i-1][0])));
      return [0,1,2].map(function(k) { return stops[i-1][1][k]*(1-t) + stops[i][1][k]*t; }).concat([1]);
    }
  }
  return [0,0.408,0.216,1];
}`;

export async function onRequest({ request, env }) {
  if (request.method === 'GET') return json({
    success: true, service: 'Hull Ag Solutions Sentinel-2 NDVI',
    status: 'ready', usage: 'POST JSON {bbox:[west,south,east,north],from:"YYYY-MM-DD",to:"YYYY-MM-DD"}',
    credentialsConfigured: Boolean(env.SENTINEL_CLIENT_ID && env.SENTINEL_CLIENT_SECRET)
  });
  if (request.method !== 'POST') return json({ error: 'Use POST to request NDVI imagery.' }, 405);
  if (!env.SENTINEL_CLIENT_ID || !env.SENTINEL_CLIENT_SECRET)
    return json({ error: 'Missing SENTINEL_CLIENT_ID or SENTINEL_CLIENT_SECRET in Cloudflare Pages environment variables.' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Request body must be JSON.' }, 400); }
  const { bbox, from, to } = body || {};
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(x => typeof x === 'number' && Number.isFinite(x)) ||
      bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90 || bbox[0] >= bbox[2] || bbox[1] >= bbox[3] ||
      bbox[2] - bbox[0] > 0.5 || bbox[3] - bbox[1] > 0.5)
    return json({ error: 'Invalid paddock bounding box (maximum 0.5 degrees per side).' }, 400);
  if (![from,to].every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))) || from > to)
    return json({ error: 'Choose a valid From and To date.' }, 400);
  if (Date.parse(to) - Date.parse(from) > 366 * 86400000)
    return json({ error: 'Choose a date range of one year or less.' }, 400);
  const midLat = (bbox[1] + bbox[3]) / 2;
  const widthM = (bbox[2] - bbox[0]) * 111320 * Math.cos(midLat * Math.PI / 180);
  const heightM = (bbox[3] - bbox[1]) * 111320;
  const scale = Math.min(1, 1200 / Math.max(widthM / 10, heightM / 10));
  const width = Math.max(64, Math.min(1200, Math.round(widthM / 10 * scale)));
  const height = Math.max(64, Math.min(1200, Math.round(heightM / 10 * scale)));
  const payload = {
    input: {
      bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
      data: [{ type: 'sentinel-2-l2a', dataFilter: {
        timeRange: { from: from + 'T00:00:00Z', to: to + 'T23:59:59Z' },
        mosaickingOrder: 'leastCC'
      } }]
    },
    output: { width, height, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
    evalscript: EVALSCRIPT
  };
  try {
    const token = await accessToken(env);
    const res = await fetch(PROCESS_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'image/png' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      return json({ error: 'Copernicus imagery request failed (' + res.status + '). ' + detail }, res.status >= 500 ? 502 : 422);
    }
    const contentType = res.headers.get('Content-Type') || '';
    if (!contentType.includes('image/png')) return json({ error: 'Copernicus returned an unexpected response.' }, 502);
    return new Response(res.body, {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' }
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected NDVI service error.' }, 502);
  }
}
