import type { MovieDetail, MoviePage } from './types';

/** Để trống khi chạy dev (Vite proxy). Khi deploy tách domain: VITE_API_URL=https://api.example.com */
const API_BASE: string = import.meta.env.VITE_API_URL ?? '';

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

export const api = {
  createRoom: () => request<{ id: string }>('/api/rooms', { method: 'POST' }),
  getRoom: (id: string) => request<{ id: string; memberCount: number }>(`/api/rooms/${encodeURIComponent(id)}`),
  searchMovies: (q: string, page = 1) =>
    request<MoviePage>(`/api/movies?q=${encodeURIComponent(q)}&page=${page}`),
  movieDetail: (id: string) => request<MovieDetail>(`/api/movies/${encodeURIComponent(id)}`),
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
