import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import type { PlayerHandle } from '../types';
import type { PlayerCallbacks } from './VideoPlayer';

interface Props extends PlayerCallbacks {
  url: string;
}

/** Phát link mp4 / webm trực tiếp, hoặc m3u8 (HLS) qua hls.js. */
export function HtmlVideoPlayer({ url, ...callbacks }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cb = useRef(callbacks);
  cb.current = callbacks;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;

    const isHls = /\.m3u8(\?|#|$)/i.test(url);
    if (isHls && !video.canPlayType('application/vnd.apple.mpegurl') && Hls.isSupported()) {
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) cb.current.onError('Không phát được luồng HLS này.');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url;
    }

    const handle: PlayerHandle = {
      play: () => void video.play().catch(() => cb.current.onBlocked?.()),
      pause: () => video.pause(),
      seek: (t) => {
        video.currentTime = t;
      },
      getTime: () => video.currentTime,
      isPlaying: () => !video.paused && !video.ended,
    };

    const onLoaded = () => cb.current.onReady(handle);
    const onPlay = () => cb.current.onPlay(video.currentTime);
    const onPause = () => {
      if (!video.seeking) cb.current.onPause(video.currentTime);
    };
    const onSeeked = () => cb.current.onSeek(video.currentTime);
    const onError = () => {
      if (!hls) cb.current.onError('Không phát được video từ link này.');
    };

    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [url]);

  return <video ref={videoRef} className="player-frame" controls playsInline preload="auto" />;
}
