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
  movieTitle?: string;
  episodeTitle?: string;
  hasEpisodes?: boolean;
  onOpenEpisodes?(): void;
  hasNextEpisode?: boolean;
  onNextEpisode?(): void;
  onToggleFullscreen?(): void;
  isFullscreen?: boolean;
}

/** Chọn trình phát phù hợp theo loại nguồn. Đổi nguồn = tạo lại trình phát. */
export function VideoPlayer({
  source,
  movieTitle,
  episodeTitle,
  hasEpisodes,
  onOpenEpisodes,
  hasNextEpisode,
  onNextEpisode,
  onToggleFullscreen,
  isFullscreen,
  ...callbacks
}: Props) {
  if (source.type === 'youtube') {
    return <YouTubePlayer key={source.url} videoId={source.url} {...callbacks} />;
  }
  return (
    <HtmlVideoPlayer
      key={source.url}
      url={source.url}
      movieTitle={movieTitle}
      episodeTitle={episodeTitle}
      hasEpisodes={hasEpisodes}
      onOpenEpisodes={onOpenEpisodes}
      hasNextEpisode={hasNextEpisode}
      onNextEpisode={onNextEpisode}
      onToggleFullscreen={onToggleFullscreen}
      isFullscreen={isFullscreen}
      {...callbacks}
    />
  );
}
