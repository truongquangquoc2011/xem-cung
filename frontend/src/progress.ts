/**
 * Lưu tiến độ xem trên máy (localStorage) cho chế độ "Xem một mình" và hàng "Tiếp tục xem".
 * Không cần tài khoản; mỗi trình duyệt nhớ riêng.
 */

export interface WatchProgress {
  movieId: string;
  title: string;
  poster?: string;
  backdrop?: string;
  /** Vị trí tập trong danh sách tập gốc của phim. */
  epIndex: number;
  /** Tên tập ("Tập 5 (Vietsub #1)"), rỗng với phim lẻ. */
  epName: string;
  /** Có nhiều tập không (để hiện "Tập 5" trên thẻ). */
  multiEpisode: boolean;
  position: number;
  duration: number;
  updatedAt: number;
}

const KEY = 'xemcung:progress';
const MAX_ITEMS = 30;
/** Xem chưa tới chừng này giây thì chưa tính là "đang xem dở". */
export const MIN_RESUME_SECONDS = 10;

function readAll(): Record<string, WatchProgress> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, WatchProgress>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, WatchProgress>) {
  try {
    // Chỉ giữ MAX_ITEMS phim mới xem nhất
    const kept = Object.values(all)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ITEMS);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept.map((p) => [p.movieId, p]))));
  } catch {
    /* trình duyệt chặn storage / hết dung lượng */
  }
}

export function getProgress(movieId: string): WatchProgress | null {
  return readAll()[movieId] ?? null;
}

export function saveProgress(p: Omit<WatchProgress, 'updatedAt'>) {
  const all = readAll();
  all[p.movieId] = { ...p, updatedAt: Date.now() };
  writeAll(all);
}

export function removeProgress(movieId: string) {
  const all = readAll();
  delete all[movieId];
  writeAll(all);
}

/** Danh sách đang xem dở, mới nhất trước. */
export function listProgress(): WatchProgress[] {
  return Object.values(readAll())
    .filter((p) => p.position >= MIN_RESUME_SECONDS || p.epIndex > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Đã xem gần hết (còn < 3% hoặc < 90 giây). */
export function isNearEnd(position: number, duration: number): boolean {
  if (!duration || duration < 60) return false;
  return position >= duration * 0.97 || duration - position < 90;
}

/** Phần trăm đã xem (0..100) để vẽ thanh tiến độ trên thẻ. */
export function percentWatched(p: WatchProgress): number {
  if (!p.duration) return 0;
  return Math.max(2, Math.min(100, Math.round((p.position / p.duration) * 100)));
}
