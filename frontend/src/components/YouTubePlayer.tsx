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
    let pollTimer: number | undefined;
    let lastTime = 0;
    let lastTick = Date.now();
    let programmaticSeekUntil = 0;
    const host = hostRef.current;

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !host) return;
        const el = document.createElement('div');
        host.appendChild(el);

        const handle: PlayerHandle = {
          play: () => player?.playVideo(),
          pause: () => player?.pauseVideo(),
          seek: (t) => {
            programmaticSeekUntil = Date.now() + 1500;
            lastTime = t;
            lastTick = Date.now();
            player?.seekTo(t, true);
          },
          getTime: () => player?.getCurrentTime() ?? 0,
          getDuration: () => player?.getDuration() ?? 0,
          isPlaying: () => {
            const s = player?.getPlayerState();
            return s === YT.PlayerState.PLAYING || s === YT.PlayerState.BUFFERING;
          },
        };

        const detectUserSeek = () => {
          if (!player) return;
          const now = Date.now();
          const t = player.getCurrentTime();
          const st = player.getPlayerState();
          const dt = (now - lastTick) / 1000;
          const expectedLocal = st === YT.PlayerState.PLAYING ? lastTime + Math.max(0, dt) : lastTime;
          if (now > programmaticSeekUntil && Math.abs(t - expectedLocal) > 2.5) {
            lastTime = t;
            lastTick = now;
            cb.current.onSeek(t, true);
            return;
          }
          lastTime = t;
          lastTick = now;
        };

        player = new YT.Player(el, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { autoplay: 0, rel: 0, playsinline: 1, modestbranding: 1 },
          events: {
            onReady: () => {
              lastTime = player?.getCurrentTime() ?? 0;
              lastTick = Date.now();
              pollTimer = window.setInterval(detectUserSeek, 300);
              cb.current.onReady(handle);
            },
            onStateChange: (e: { data: number }) => {
              if (!player) return;
              detectUserSeek();
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
      window.clearInterval(pollTimer);
      player?.destroy();
      // Đặt về null để handle cũ (nếu còn ai giữ) thành no-op, tránh gọi seekTo vào player đã huỷ -> sập trang
      player = null;
      if (host) host.innerHTML = '';
    };
  }, [videoId]);

  return <div className="player-frame" ref={hostRef} />;
}
