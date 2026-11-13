import type { VideoSource } from './types';
import { parseYouTubeId } from './youtube';

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const NAME_KEY = 'watch-party:name';

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* trình duyệt chặn storage */
  }
}

/** Màu avatar cố định theo tên. */
export function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 55%)`;
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(-1)[0]?.charAt(0).toUpperCase() || '?';
}

/** Tin nhắn chỉ gồm emoji (dùng để thả emoji bay trên video). */
export function isEmojiOnly(text: string): boolean {
  return /^(\p{Extended_Pictographic}|️|‍|\s){1,12}$/u.test(text) && /\p{Extended_Pictographic}/u.test(text);
}

/** Tự nhận diện link YouTube khi tạo VideoSource từ tập phim. */
export function toVideoSource(url: string, title = ''): VideoSource {
  const ytId = parseYouTubeId(url);
  if (ytId) return { type: 'youtube', url: ytId, title };
  return { type: 'video', url, title };
}
