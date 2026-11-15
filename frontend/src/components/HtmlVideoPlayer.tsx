import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { resolveApiUrl, resolveHlsUrl } from '../api';
import type { PlayerHandle } from '../types';
import type { PlayerCallbacks } from './VideoPlayer';

interface Props extends PlayerCallbacks {
  url: string;
  movieTitle?: string;
  episodeTitle?: string;
  hasEpisodes?: boolean;
  onOpenEpisodes?(): void;
  hasNextEpisode?: boolean;
  onNextEpisode?(): void;
  onToggleFullscreen?(): void;
  isFullscreen?: boolean;
}

interface SubtitleTrack {
  label: string;
  lang: string;
  url: string;
  isDefault: boolean;
}

const PROXY_HLS_REGEX = /\/api\/movies\/hls\/([^/]+)\/([^/]+)\/master\.m3u8/;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Phát link mp4 / webm trực tiếp, hoặc m3u8 (HLS) qua hls.js với giao diện rạp chiếu tuỳ chỉnh. */
export function HtmlVideoPlayer({
  url,
  movieTitle,
  episodeTitle,
  hasEpisodes,
  onOpenEpisodes,
  hasNextEpisode,
  onNextEpisode,
  onToggleFullscreen,
  isFullscreen = false,
  ...callbacks
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const cb = useRef(callbacks);
  cb.current = callbacks;

  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const [ccEnabled, setCcEnabled] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [volume, setVolume] = useState(() => {
    try {
      const saved = localStorage.getItem('xemcung.volume');
      return saved !== null ? Math.min(1, Math.max(0, Number(saved))) : 1;
    } catch {
      return 1;
    }
  });
  const [muted, setMuted] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);

  const revealControls = () => {
    setControlsVisible(true);
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false);
      }
    }, 3200);
  };

  useEffect(() => {
    return () => window.clearTimeout(hideTimerRef.current);
  }, []);

  // Đồng bộ volume & speed lên thẻ <video>
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
    try {
      localStorage.setItem('xemcung.volume', String(volume));
    } catch {
      /* ignore */
    }
  }, [volume, muted]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = SPEEDS[speedIdx];
    }
  }, [speedIdx]);

  // Tự động lấy danh sách phụ đề nếu là nguồn phim VSMOV qua proxy HLS
  useEffect(() => {
    setSubtitles([]);
    const m = PROXY_HLS_REGEX.exec(url);
    if (!m) return;
    const [, host, hash] = m;
    let cancelled = false;

    fetch(resolveApiUrl(`/api/movies/hls/${encodeURIComponent(host)}/${encodeURIComponent(hash)}/subtitles`))
      .then((res) => (res.ok ? (res.json() as Promise<SubtitleTrack[]>) : []))
      .then((tracks) => {
        if (!cancelled && Array.isArray(tracks)) {
          setSubtitles(tracks.map((t) => ({ ...t, url: resolveApiUrl(t.url) })));
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

    const applyTrackMode = () => {
      const tracks = video.textTracks;
      if (!tracks || tracks.length === 0) return;
      if (!ccEnabled) {
        for (let i = 0; i < tracks.length; i++) tracks[i].mode = 'disabled';
        return;
      }
      let hasShowing = false;
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].mode === 'showing') {
          hasShowing = true;
          break;
        }
      }
      if (!hasShowing) {
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

    const t1 = setTimeout(applyTrackMode, 150);
    const t2 = setTimeout(applyTrackMode, 600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [subtitles, ccEnabled]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    const playUrl = resolveHlsUrl(url);
    setBuffering(true);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setScrubTime(null);

    const isHls = /\.m3u8(\?|#|$)|\/master\?/i.test(playUrl);
    if (isHls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        startFragPrefetch: true,
        maxBufferLength: 20,
        maxMaxBufferLength: 35,
        maxBufferSize: 25 * 1000 * 1000,
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
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
          networkRetries++;
          hls?.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
        } else {
          setBuffering(false);
          cb.current.onError('Không phát được luồng HLS này.');
        }
      });
      hls.loadSource(playUrl);
      hls.attachMedia(video);
    } else {
      video.src = playUrl;
    }

    const handle: PlayerHandle = {
      play: () => {
        void video.play().catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          cb.current.onBlocked?.();
        });
      },
      pause: () => video.pause(),
      seek: (t) => {
        video.currentTime = t;
      },
      getTime: () => video.currentTime,
      isPlaying: () => !video.paused && !video.ended,
      isSeeking: () => video.seeking || isDraggingRef.current,
    };

    let readyFired = false;
    const onLoaded = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
      if (readyFired) return;
      readyFired = true;
      setBuffering(false);
      cb.current.onReady(handle);
    };
    const onPlay = () => {
      setPlaying(true);
      cb.current.onPlay(video.currentTime);
    };
    const onPause = () => {
      setPlaying(false);
      setControlsVisible(true);
      if (!video.seeking) cb.current.onPause(video.currentTime);
    };
    const onPlayingState = () => {
      setPlaying(true);
      setBuffering(false);
    };
    const onWaiting = () => setBuffering(true);
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
      if (video.buffered.length > 0) {
        setBufferedEnd(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onSeeking = () => {
      setBuffering(true);
    };
    const onSeeked = () => setBuffering(false);
    const onError = () => {
      setBuffering(false);
      if (!hls) cb.current.onError('Không phát được video từ link này.');
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('canplay', onLoaded);
    if (video.readyState >= 1) {
      onLoaded();
    }
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('playing', onPlayingState);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('canplay', onLoaded);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('playing', onPlayingState);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [url]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      void v.play().catch(() => cb.current.onBlocked?.());
    } else {
      v.pause();
    }
    revealControls();
  };

  const isDraggingRef = useRef(false);

  const commitUserSeek = (rawTarget: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(rawTarget)) return;
    const max = duration > 0 ? duration : (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Number.MAX_SAFE_INTEGER);
    const clamped = Math.max(0, Math.min(max, rawTarget));
    v.currentTime = clamped;
    setCurrentTime(clamped);
    setScrubTime(null);
    cb.current.onSeek(clamped, true);
    revealControls();
  };

  const jumpBy = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    commitUserSeek(v.currentTime + delta);
  };

  const togglePiP = async () => {
    const v = videoRef.current;
    if (!v || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      /* ignore */
    }
  };

  const shownTime = scrubTime !== null ? scrubTime : currentTime;
  const maxTime = duration > 0 ? duration : Math.max(1, shownTime);
  const progressPct = Math.min(100, Math.max(0, (shownTime / maxTime) * 100));
  const bufferPct = Math.min(100, Math.max(progressPct, (bufferedEnd / maxTime) * 100));
  const showHud = controlsVisible || !playing || buffering;

  return (
    <div
      className={`cp-wrap ${showHud ? 'hud-on' : 'hud-off'}`}
      onMouseMove={revealControls}
      onMouseLeave={() => {
        if (playing) setControlsVisible(false);
      }}
      onTouchStart={revealControls}
    >
      <video
        ref={videoRef}
        className="player-frame"
        playsInline
        preload="auto"
        onClick={() => {
          const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
          if (isTouch && !controlsVisible && playing) {
            revealControls();
            return;
          }
          togglePlay();
        }}
        onDoubleClick={onToggleFullscreen}
      >
        {subtitles.map((sub) => (
          <track
            key={sub.url}
            kind="subtitles"
            src={resolveHlsUrl(sub.url)}
            srcLang={sub.lang}
            label={sub.label}
            default={sub.isDefault}
          />
        ))}
      </video>

      {/* Top Gradient & Header */}
      <div className="cp-top">
        <div className="cp-title-group">
          {movieTitle && <p className="cp-movie-title">{movieTitle}</p>}
          {episodeTitle && <p className="cp-ep-title">{episodeTitle}</p>}
        </div>
        {hasEpisodes && onOpenEpisodes && (
          <button type="button" className="cp-ep-btn" onClick={onOpenEpisodes}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M4 6h12v2H4V6zm0 5h12v2H4v-2zm0 5h8v2H4v-2zm15-2v4l4-2-4-2zm-2-5v2h5V9h-5z"
              />
            </svg>
            <span>Danh sách tập</span>
          </button>
        )}
      </div>

      {/* Center Loading Spinner */}
      {buffering && (
        <div className="cp-center" aria-label="Đang tải video">
          <div className="cp-spinner" />
        </div>
      )}

      {/* Bottom Controls */}
      <div className="cp-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="cp-time-row">
          <span>{formatTime(shownTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <div className="cp-progress-wrap">
          <input
            type="range"
            min={0}
            max={maxTime}
            step={0.5}
            value={Math.min(shownTime, maxTime)}
            aria-label="Thanh tua video"
            className="cp-progress"
            style={{
              background: `linear-gradient(to right, #e5232f 0%, #e5232f ${progressPct}%, rgba(255,255,255,0.34) ${progressPct}%, rgba(255,255,255,0.34) ${bufferPct}%, rgba(255,255,255,0.16) ${bufferPct}%, rgba(255,255,255,0.16) 100%)`,
            }}
            onPointerDown={() => {
              isDraggingRef.current = true;
            }}
            onInput={(e) => {
              const val = Number((e.currentTarget as HTMLInputElement).value);
              setScrubTime(val);
            }}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (isDraggingRef.current) {
                setScrubTime(val);
              } else {
                commitUserSeek(val);
              }
            }}
            onPointerUp={(e) => {
              isDraggingRef.current = false;
              const val = Number((e.currentTarget as HTMLInputElement).value);
              commitUserSeek(val);
            }}
            onTouchEnd={(e) => {
              isDraggingRef.current = false;
              const val = Number((e.currentTarget as HTMLInputElement).value);
              commitUserSeek(val);
            }}
            onKeyUp={(e) => {
              const val = Number((e.currentTarget as HTMLInputElement).value);
              commitUserSeek(val);
            }}
          />
        </div>

        <div className="cp-bar">
          <div className="cp-left">
            <button
              type="button"
              className="cp-btn"
              onClick={togglePlay}
              aria-label={playing ? 'Tạm dừng' : 'Phát'}
              title={playing ? 'Tạm dừng' : 'Phát'}
            >
              {playing ? (
                <svg viewBox="0 0 24 24" width="22" height="22">
                  <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="22" height="22">
                  <path fill="currentColor" d="M8 5v14l11-7-11-7z" />
                </svg>
              )}
            </button>

            <button
              type="button"
              className="cp-btn cp-seek-btn"
              onClick={() => jumpBy(-10)}
              aria-label="Tua lùi 10 giây"
              title="Tua lùi 10 giây"
            >
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path
                  fill="currentColor"
                  d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
                />
              </svg>
              <span className="cp-seek-num">10</span>
            </button>

            <button
              type="button"
              className="cp-btn cp-seek-btn"
              onClick={() => jumpBy(10)}
              aria-label="Tua tới 10 giây"
              title="Tua tới 10 giây"
            >
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path
                  fill="currentColor"
                  d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"
                />
              </svg>
              <span className="cp-seek-num">10</span>
            </button>

            <div className="cp-vol">
              <button
                type="button"
                className="cp-btn"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted || volume === 0 ? 'Bật tiếng' : 'Tắt tiếng'}
                title={muted || volume === 0 ? 'Bật tiếng' : 'Tắt tiếng'}
              >
                {muted || volume === 0 ? (
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <path
                      fill="currentColor"
                      d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <path
                      fill="currentColor"
                      d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                    />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label="Âm lượng"
                className="cp-vol-slider"
                style={{
                  background: `linear-gradient(to right, #e5232f 0%, #e5232f ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.28) ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.28) 100%)`,
                }}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setVolume(val);
                  if (val > 0 && muted) setMuted(false);
                }}
              />
            </div>
          </div>

          <div className="cp-right">
            {hasNextEpisode && onNextEpisode && (
              <button
                type="button"
                className="cp-btn cp-next-btn"
                onClick={onNextEpisode}
                title="Chuyển tập tiếp theo"
              >
                ⏭ Tập tiếp
              </button>
            )}

            {subtitles.length > 0 && (
              <button
                type="button"
                className={`cp-btn cp-pill-tag ${ccEnabled ? 'active' : ''}`}
                onClick={() => setCcEnabled((v) => !v)}
                aria-label="Phụ đề"
                title={ccEnabled ? 'Tắt phụ đề' : 'Bật phụ đề'}
              >
                CC
              </button>
            )}

            <button
              type="button"
              className="cp-btn cp-pill-tag"
              onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
              title="Tốc độ phát"
            >
              {SPEEDS[speedIdx]}x
            </button>

            <span className="cp-hd-badge" title="Độ phân giải cao">
              HD
            </span>

            {typeof document !== 'undefined' && document.pictureInPictureEnabled && (
              <button
                type="button"
                className="cp-btn"
                onClick={() => void togglePiP()}
                aria-label="Hình trong hình"
                title="Hình trong hình (PiP)"
              >
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path
                    fill="currentColor"
                    d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"
                  />
                </svg>
              </button>
            )}

            {onToggleFullscreen && (
              <button
                type="button"
                className="cp-btn"
                onClick={onToggleFullscreen}
                aria-label={isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
                title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
              >
                {isFullscreen ? (
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <path
                      fill="currentColor"
                      d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <path
                      fill="currentColor"
                      d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"
                    />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
