const SAFE_HOST = /^(v\d+\.streamvsmov\.com|embed\d*\.streamc\.xyz)$/;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function isBlockedHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

function parsePublicHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (isBlockedHost(u.hostname)) return null;
  return u;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  const host = typeof req.query.host === 'string' ? req.query.host.trim() : 'embed1.streamc.xyz';

  const target = parsePublicHttpUrl(rawUrl);
  if (!target) {
    return res.status(400).json({ message: 'URL segment không hợp lệ' });
  }

  const originHost = SAFE_HOST.test(host)
    ? host.endsWith('.streamvsmov.com')
      ? 'v10.streamvsmov.com'
      : host
    : target.hostname;

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        'User-Agent': UA,
        Origin: `https://${originHost}`,
        Referer: `https://${originHost}/`,
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ message: `Upstream error ${upstream.status}` });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp2t');
    res.setHeader('Cache-Control', 'public, max-age=21600, s-maxage=21600');
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(502).json({ message: err instanceof Error ? err.message : 'Lỗi tải segment' });
  }
}
