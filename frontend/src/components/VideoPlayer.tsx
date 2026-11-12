import type { PlayerHandle, VideoSource } from '../types';
import { HtmlVideoPlayer } from './HtmlVideoPlayer';
import { YouTubePlayer } from './YouTubePlayer';

export interface PlayerCallbacks {
  onReady(handle: PlayerHandle): void;
  onPlay(time: number): void;
  onPause(time: number): void;
  /** byUser = true khi chắc chắn do người dùng kéo thanh tua (không phải máy tự tua). */
  onSeek(time: number, byUser?: boolean): void;
  onError(message: string): void;
  /** Trình duyệt chặn tự phát (cần người dùng bấm). */
  onBlocked?(): void;
}

interface Props extends PlayerCallbacks {
  source: VideoSource;
}

/** Chọn trình phát phù hợp theo loại nguồn. Đổi nguồn = tạo lại trình phát. */
export function VideoPlayer({ source, ...callbacks }: Props) {
  if (source.type === 'youtube') {
    return <YouTubePlayer key={source.url} videoId={source.url} {...callbacks} />;
  }
  return <HtmlVideoPlayer key={source.url} url={source.url} {...callbacks} />;
}
