const SAFE_HOST = /^(v\d+\.streamvsmov\.com|embed\d*\.streamc\.xyz)$/;
const SAFE_HASH = /^[A-Za-z0-9-]+$/;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function jsonError(status, message) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

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

async function fetchNguonCPlaylist(host, hash) {
  const embedUrl = `https://${host}/embed.php?hash=${hash}`;
  const bootRes = await fetch(embedUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Origin: `https://${host}`,
      Referer: embedUrl,
    },
    body: JSON.stringify({
      action: 'bootstrap',
      referrer: 'https://phim.nguonc.com/',
      frame_origins: ['https://phim.nguonc.com'],
      request_grant: true,
      playlist_format: 'hls',
      pretty_url: true,
      path_chunks: true,
      bootstrap_format: 'json',
    }),
  });
  if (!bootRes.ok) {
    throw new Error(`Bootstrap Nguồn C lỗi HTTP ${bootRes.status}`);
  }
  const boot = await bootRes.json();
  const playlistUrl = (boot?.preissued?.playlist ?? '').trim();
  if (!playlistUrl) {
    throw new Error('Nguồn C không trả về playlist HLS');
  }
  const plRes = await fetch(playlistUrl, {
    headers: {
      'User-Agent': UA,
      Origin: `https://${host}`,
      Referer: embedUrl,
    },
  });
  if (!plRes.ok) {
    throw new Error(`Không tải được playlist Nguồn C (HTTP ${plRes.status})`);
  }
  return await plRes.text();
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonError(405, 'Method not allowed');
    }

    const reqUrl = new URL(request.url);
    const path = reqUrl.pathname;

    if (path === '/' || path === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'xem-cung-hls-worker' }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
      });
    }

    // 1. Proxy master.m3u8 và viết lại URL segment trỏ về /seg trên chính Cloudflare Worker
    if (path === '/master') {
      const host = (reqUrl.searchParams.get('host') ?? '').trim();
      const hash = (reqUrl.searchParams.get('hash') ?? '').trim();
      if (!SAFE_HOST.test(host) || !SAFE_HASH.test(hash)) {
        return jsonError(400, 'Tham số HLS không hợp lệ');
      }

      try {
        const m3u8 = host.endsWith('.streamc.xyz')
          ? await fetchNguonCPlaylist(host, hash)
          : await (
              await fetch(`https://${host}/stream/${hash}/master.m3u8`, {
                headers: { 'User-Agent': UA },
              })
            ).text();

        if (!m3u8 || !m3u8.trim()) {
          return jsonError(502, 'Không tải được playlist HLS');
        }

        const workerOrigin = reqUrl.origin;
        const rewritten = m3u8.replace(/^https?:\/\/[^\r\n]+$/gm, (line) => {
          const segUrl = line.trim();
          return `${workerOrigin}/seg?host=${encodeURIComponent(host)}&url=${encodeURIComponent(segUrl)}`;
        });

        return new Response(rewritten, {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
            ...CORS_HEADERS,
          },
        });
      } catch (err) {
        return jsonError(502, err instanceof Error ? err.message : 'Lỗi tải playlist');
      }
    }

    // 2. Stream segment .ts trực tiếp từ CDN về trình duyệt (không qua backend Render)
    if (path === '/seg') {
      const rawSegUrl = reqUrl.searchParams.get('url') ?? '';
      const host = (reqUrl.searchParams.get('host') ?? 'embed1.streamc.xyz').trim();
      const target = parsePublicHttpUrl(rawSegUrl);
      if (!target) {
        return jsonError(400, 'URL segment không hợp lệ');
      }

      const originHost = SAFE_HOST.test(host)
        ? host.endsWith('.streamvsmov.com')
          ? 'v10.streamvsmov.com'
          : host
        : target.hostname;

      const upstream = await fetch(target.toString(), {
        headers: {
          'User-Agent': UA,
          Origin: `https://${originHost}`,
          Referer: `https://${originHost}/`,
        },
        cf: { cacheEverything: true, cacheTtl: 21600 },
      });

      if (!upstream.ok) {
        return jsonError(upstream.status, `Upstream segment error ${upstream.status}`);
      }

      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'video/mp2t',
          'Cache-Control': 'public, max-age=21600',
          ...CORS_HEADERS,
        },
      });
    }

    // 3. Proxy phụ đề .vtt
    if (path === '/vtt') {
      const rawVttUrl = reqUrl.searchParams.get('url') ?? '';
      const target = parsePublicHttpUrl(rawVttUrl);
      if (!target || !target.hostname.endsWith('.streamvsmov.com')) {
        return jsonError(400, 'URL phụ đề không hợp lệ');
      }
      const upstream = await fetch(target.toString(), {
        headers: {
          'User-Agent': UA,
          Origin: `https://${target.hostname}`,
          Referer: `https://${target.hostname}/`,
        },
      });
      if (!upstream.ok) {
        return jsonError(upstream.status, `Upstream VTT error ${upstream.status}`);
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/vtt; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          ...CORS_HEADERS,
        },
      });
    }

    return jsonError(404, 'Not found');
  },
};
