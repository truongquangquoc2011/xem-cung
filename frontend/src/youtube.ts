/** Kiểu tối thiểu cho YouTube IFrame API (tránh phải cài @types/youtube). */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

export interface YTNamespace {
  Player: new (el: HTMLElement, options: unknown) => YTPlayer;
  PlayerState: { UNSTARTED: number; ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT!);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => {
        loading = null;
        reject(new Error('Không tải được YouTube'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

const ID = /^[A-Za-z0-9_-]{11}$/;

/** Nhận link youtube.com/watch?v=, youtu.be/, /shorts/, /embed/ hoặc ID trần. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (ID.test(s)) return s;
  let id: string | null = null;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') {
      id = u.pathname.slice(1, 12);
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/)?.[1] ?? null;
    }
  } catch {
    return null;
  }
  return id && ID.test(id) ? id : null;
}

/** Lấy tiêu đề video qua oEmbed; lỗi thì trả null. */
export async function fetchYouTubeTitle(id: string): Promise<string | null> {
  try {
    const target = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
    const res = await fetch(`https://www.youtube.com/oembed?url=${target}&format=json`);
    if (res.ok) return (await res.json()).title ?? null;
  } catch {
    /* bỏ qua */
  }
  return null;
}
