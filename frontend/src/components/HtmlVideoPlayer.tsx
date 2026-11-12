import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { PlayerHandle } from '../types';
import type { PlayerCallbacks } from './VideoPlayer';

interface Props extends PlayerCallbacks {
  url: string;
}

interface SubtitleTrack {
  label: string;
  lang: string;
  url: string;
  isDefault: boolean;
}

const PROXY_HLS_REGEX = /\/api\/movies\/hls\/([^/]+)\/([^/]+)\/master\.m3u8/;

/** Phát link mp4 / webm trực tiếp, hoặc m3u8 (HLS) qua hls.js kèm phụ đề VTT. */
export function HtmlVideoPlayer({ url, ...callbacks }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cb = useRef(callbacks);
  cb.current = callbacks;

  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);

  // Tự động lấy danh sách phụ đề nếu là nguồn phim VSMOV qua proxy HLS
  useEffect(() => {
    setSubtitles([]);
    const m = PROXY_HLS_REGEX.exec(url);
    if (!m) return;
    const [, host, hash] = m;
    let cancelled = false;

    fetch(`/api/movies/hls/${encodeURIComponent(host)}/${encodeURIComponent(hash)}/subtitles`)
      .then((res) => (res.ok ? (res.json() as Promise<SubtitleTrack[]>) : []))
      .then((tracks) => {
        if (!cancelled && Array.isArray(tracks)) {
          setSubtitles(tracks);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Kích hoạt hiển thị phụ đề mặc định (Tiếng Việt) ngay khi track gắn vào thẻ <video>
  useEffect(() => {
    const video = videoRef.current;
    if (!video || subtitles.length === 0) return;

    const activateDefaultTrack = () => {
      const tracks = video.textTracks;
      if (!tracks || tracks.length === 0) return;
      let hasShowing = false;
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].mode === 'showing') {
          hasShowing = true;
          break;
        }
      }
      if (!hasShowing) {
        // Ưu tiên tiếng Việt, không có thì lấy track đầu tiên
        let pick = tracks[0];
        for (let i = 0; i < tracks.length; i++) {
          if (tracks[i].language === 'vi') {
            pick = tracks[i];
            break;
          }
        }
        pick.mode = 'showing';
      }
    };

    const t1 = setTimeout(activateDefaultTrack, 150);
    const t2 = setTimeout(activateDefaultTrack, 600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [subtitles]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;

    const isHls = /\.m3u8(\?|#|$)/i.test(url);
    if (isHls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        startFragPrefetch: true,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        maxBufferSize: 60 * 1000 * 1000,
        backBufferLength: 30,
        fragLoadingTimeOut: 25000,
        fragLoadingMaxRetry: 6,
      });
      let networkRetries = 0;
      hls.on(Hls.Events.FRAG_LOADED, () => {
        networkRetries = 0;
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        // Thử lại tối đa 3 lần, tránh lặp vô hạn khi link chết
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
          networkRetries++;
          hls?.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
        } else {
          cb.current.onError('Không phát được luồng HLS này.');
        }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else {
      video.src = url;
    }

    /** Vị trí máy tự tua tới (để không nhầm là người dùng tua). */
    let programmaticTarget: number | null = null;
    /** Gom các lần kéo thanh tua liên tục thành 1 lệnh gửi lên phòng. */
    let userSeekTimer: number | undefined;

    const handle: PlayerHandle = {
      play: () => {
        void video.play().catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          cb.current.onBlocked?.();
        });
      },
      pause: () => video.pause(),
      seek: (t) => {
        programmaticTarget = t;
        video.currentTime = t;
      },
      getTime: () => video.currentTime,
      isPlaying: () => !video.paused && !video.ended,
      isSeeking: () => video.seeking || userSeekTimer !== undefined,
    };

    let readyFired = false;
    const onLoaded = () => {
      if (readyFired) return;
      readyFired = true;
      cb.current.onReady(handle);
    };
    // Dùng 'play' (chỉ bắn khi chuyển từ dừng -> phát), KHÔNG dùng 'playing':
    // 'playing' bắn lại sau mỗi lần mạng giật, làm người mạng chậm kéo cả phòng lùi lại.
    const onPlay = () => cb.current.onPlay(video.currentTime);
    const onPause = () => {
      if (!video.seeking) cb.current.onPause(video.currentTime);
    };
    // Báo ngay lúc bắt đầu tua ('seeking'), không đợi 'seeked' vì HLS có thể tải mất vài giây
    const onSeeking = () => {
      if (programmaticTarget !== null && Math.abs(video.currentTime - programmaticTarget) < 0.5) {
        programmaticTarget = null;
        return;
      }
      programmaticTarget = null;
      window.clearTimeout(userSeekTimer);
      userSeekTimer = window.setTimeout(() => {
        userSeekTimer = undefined;
        cb.current.onSeek(video.currentTime, true);
      }, 250);
    };
    const onError = () => {
      if (!hls) cb.current.onError('Không phát được video từ link này.');
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('canplay', onLoaded);
    if (video.readyState >= 1) {
      onLoaded();
    }
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('error', onError);

    return () => {
      window.clearTimeout(userSeekTimer);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('canplay', onLoaded);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('error', onError);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [url]);

  return (
    // Không đặt crossOrigin: phụ đề đi qua /api cùng domain nên không cần,
    // còn đặt vào thì mọi link mp4 ngoài không trả header CORS (vd archive.org) đều hỏng.
    <video ref={videoRef} className="player-frame" controls playsInline preload="auto">
      {subtitles.map((sub) => (
        <track
          key={sub.url}
          kind="subtitles"
          src={sub.url}
          srcLang={sub.lang}
          label={sub.label}
          default={sub.isDefault}
        />
      ))}
    </video>
  );
}
