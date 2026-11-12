import { useEffect, useRef } from 'react';
import { loadYouTubeApi, type YTPlayer } from '../youtube';
import type { PlayerHandle } from '../types';
import type { PlayerCallbacks } from './VideoPlayer';

interface Props extends PlayerCallbacks {
  videoId: string;
}

export function YouTubePlayer({ videoId, ...callbacks }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cb = useRef(callbacks);
  cb.current = callbacks;

  useEffect(() => {
    let player: YTPlayer | null = null;
    let cancelled = false;
    const host = hostRef.current;

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !host) return;
        const el = document.createElement('div');
        host.appendChild(el);

        const handle: PlayerHandle = {
          play: () => player?.playVideo(),
          pause: () => player?.pauseVideo(),
          seek: (t) => player?.seekTo(t, true),
          getTime: () => player?.getCurrentTime() ?? 0,
          isPlaying: () => {
            const s = player?.getPlayerState();
            return s === YT.PlayerState.PLAYING || s === YT.PlayerState.BUFFERING;
          },
        };

        player = new YT.Player(el, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { autoplay: 0, rel: 0, playsinline: 1, modestbranding: 1 },
          events: {
            onReady: () => cb.current.onReady(handle),
            onStateChange: (e: { data: number }) => {
              if (!player) return;
              if (e.data === YT.PlayerState.PLAYING) cb.current.onPlay(player.getCurrentTime());
              else if (e.data === YT.PlayerState.PAUSED) cb.current.onPause(player.getCurrentTime());
            },
            onError: () => cb.current.onError('Video YouTube này không phát được (có thể bị chặn nhúng).'),
          },
        });
      })
      .catch((e: Error) => cb.current.onError(e.message));

    return () => {
      cancelled = true;
      player?.destroy();
      if (host) host.innerHTML = '';
    };
  }, [videoId]);

  return <div className="player-frame" ref={hostRef} />;
}
