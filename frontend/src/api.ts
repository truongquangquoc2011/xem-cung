import type { MovieDetail, MoviePage, RoomSummary, SkipSegment } from './types';

/** Để trống khi chạy dev (Vite proxy) hoặc khi đóng gói chung 1 container. Khi deploy tách domain: VITE_API_URL=https://api.example.com */
export const API_BASE: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** URL Cloudflare Worker chuyên proxy HLS (.m3u8/.ts/.vtt) để không tốn băng thông backend. */
export const HLS_PROXY_URL: string = (import.meta.env.VITE_HLS_PROXY_URL ?? '').replace(/\/$/, '');

/** Gắn API_BASE vào đường dẫn tương đối (/api/...) khi deploy tách domain. */
export function resolveApiUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('/api/') && API_BASE) {
    return API_BASE + url;
  }
  return url;
}

/** Nếu đã cấu hình VITE_HLS_PROXY_URL (Cloudflare Worker), chuyển toàn bộ luồng HLS & phụ đề sang Worker. */
export function resolveHlsUrl(url: string): string {
  if (!url) return url;
  if (HLS_PROXY_URL) {
    const masterMatch = /\/api\/movies\/hls\/([^/]+)\/([^/]+)\/master\.m3u8/.exec(url);
    if (masterMatch) {
      return `${HLS_PROXY_URL}/master?host=${encodeURIComponent(masterMatch[1])}&hash=${encodeURIComponent(masterMatch[2])}`;
    }
    const vttMatch = /\/api\/movies\/hls\/vtt\?url=(.+)$/.exec(url);
    if (vttMatch) {
      return `${HLS_PROXY_URL}/vtt?url=${vttMatch[1]}`;
    }
  }
  return resolveApiUrl(url);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, init);
  if (!res.ok) {
    let message = `Lỗi ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch {
      /* body không phải JSON */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const detailCache = new Map<string, Promise<MovieDetail>>();

export const api = {
  listRooms: () => request<RoomSummary[]>('/api/rooms'),
  createRoom: (title?: string, pin?: string) =>
    request<RoomSummary>('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title ?? '', pin: pin ?? '' }),
    }),
  getRoom: (id: string) => request<RoomSummary>(`/api/rooms/${encodeURIComponent(id)}`),
  closeRoom: (id: string, hostToken: string) =>
    request<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(id)}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostToken }),
    }),
  verifyRoomPin: (id: string, pin: string) =>
    request<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(id)}/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    }),
  searchMovies: (q: string, page = 1, category = '', period = '', signal?: AbortSignal) => {
    const params = new URLSearchParams({ q, page: String(page) });
    if (category) params.set('category', category);
    if (period) params.set('period', period);
    return request<MoviePage>(`/api/movies?${params.toString()}`, { signal });
  },
  searchYouTube: (q: string) =>
    request<MoviePage>(`/api/movies/youtube?q=${encodeURIComponent(q)}`),
  searchAi: (q = '') =>
    request<MoviePage>(`/api/movies/ai?q=${encodeURIComponent(q)}`),
  movieDetail: (id: string) => {
    // Nhớ chi tiết phim trong phiên: mở lại phim / hero banner không phải tải lại
    const hit = detailCache.get(id);
    if (hit) return hit;
    const p = request<MovieDetail>(`/api/movies/${encodeURIComponent(id)}`).catch((e) => {
      detailCache.delete(id);
      throw e;
    });
    detailCache.set(id, p);
    if (detailCache.size > 60) detailCache.delete(detailCache.keys().next().value as string);
    return p;
  },
  getSkipTimes: (title: string, originalTitle: string, episode: string) => {
    const params = new URLSearchParams({ title, originalTitle, episode });
    return request<SkipSegment[]>(`/api/movies/skip-times?${params.toString()}`);
  },
};

/** URL WebSocket STOMP. Ghi đè bằng VITE_WS_URL nếu backend ở domain khác. */
export function wsUrl(): string {
  const fromEnv: string | undefined = import.meta.env.VITE_WS_URL;
  if (fromEnv) return fromEnv;
  if (API_BASE) return API_BASE.replace(/^http/, 'ws') + '/ws';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/**
 * Ước lượng chênh lệch đồng hồ máy này so với server (ms), để mọi người tính
 * cùng một vị trí phát. Lấy mẫu có độ trễ thấp nhất trong 3 lần đo.
 */
export async function measureClockOffset(): Promise<number> {
  let best = { rtt: Infinity, offset: 0 };
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const { serverTime } = await request<{ serverTime: number }>('/api/time');
    const t1 = Date.now();
    const rtt = t1 - t0;
    if (rtt < best.rtt) best = { rtt, offset: serverTime + rtt / 2 - t1 };
  }
  return best.offset;
}
