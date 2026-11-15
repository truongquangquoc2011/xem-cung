import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, resolveApiUrl } from '../api';
import { nextEpisode } from '../episodes';
import { Chat } from '../components/Chat';
import { Logo } from '../components/Logo';
import { MovieLibrary } from '../components/MovieLibrary';
import { SourcePicker } from '../components/SourcePicker';
import { VideoPlayer } from '../components/VideoPlayer';
import { VoicePanel } from '../components/VoicePanel';
import { usePlaybackSync } from '../hooks/usePlaybackSync';
import { useRoom } from '../hooks/useRoom';
import { useVoiceChat } from '../hooks/useVoiceChat';
import type { MovieDetail, MovieSummary, RoomSummary, SkipSegment, VideoSource } from '../types';
import { colorFor, initials, isEmojiOnly, loadName, saveName, toVideoSource } from '../utils';

interface FloatingEmoji {
  id: string;
  emoji: string;
  left: number;
}

interface NavState {
  name?: string;
  pin?: string;
  initialSource?: VideoSource;
  initialMovieDetail?: MovieDetail;
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFranchiseBase(rawTitle: string): string {
  if (!rawTitle) return '';
  let base = rawTitle.split(' · ')[0].trim();
  base = base
    .replace(/\s*\((?:phần|phan|season|part|mùa|mua|movie|ova|special|tập|tap)\s*[^)]*\)/gi, '')
    .replace(/\s*(?:[-–—:]\s*)?(?:phần|phan|season|part|mùa|mua|movie|ova)\s*\d+.*$/gi, '')
    .replace(/\s+\d+\s*$/, '')
    .trim();
  const colonIdx = base.indexOf(':');
  if (colonIdx >= 5) {
    base = base.slice(0, colonIdx).trim();
  }
  return base;
}

export function RoomPage() {
  const { roomId = '' } = useParams();
  const id = roomId.toUpperCase();
  const location = useLocation();
  const navState = (location.state as NavState | null) ?? {};

  const [exists, setExists] = useState<boolean | null>(null);
  const [roomMeta, setRoomMeta] = useState<RoomSummary | null>(null);
  const [name, setName] = useState<string | null>(navState.name ?? null);
  const [draftName, setDraftName] = useState(navState.name || loadName());
  const [pin, setPin] = useState<string>(navState.pin ?? '');
  const [draftPin, setDraftPin] = useState<string>(navState.pin ?? '');
  const [pinVerified, setPinVerified] = useState<boolean>(Boolean(navState.pin));
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);

  useEffect(() => {
    api
      .getRoom(id)
      .then((info) => {
        setRoomMeta(info);
        setExists(true);
        if (!info.hasPin) setPinVerified(true);
      })
      .catch(() => setExists(false));
  }, [id]);

  const canConnect = Boolean(exists && name && (!roomMeta?.hasPin || pinVerified));
  const room = useRoom(id, canConnect ? name : null, pin);
  const sync = usePlaybackSync({ state: room.state, serverNow: room.serverNow, control: room.control });
  const source = room.state?.source;
  const connected = room.status === 'connected' && room.me !== null;
  const voice = useVoiceChat({
    me: room.me,
    members: room.members,
    connected,
    sendVoiceState: room.sendVoiceState,
    sendVoiceSignal: room.sendVoiceSignal,
    setVoiceSignalListener: room.setVoiceSignalListener,
  });

  const [playerError, setPlayerError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [floats, setFloats] = useState<FloatingEmoji[]>([]);
  const [showNotice, setShowNotice] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [rememberedMovie, setRememberedMovie] = useState<MovieDetail | null>(navState.initialMovieDetail ?? null);
  const [skipSegments, setSkipSegments] = useState<SkipSegment[]>([]);
  const [activeSkip, setActiveSkip] = useState<SkipSegment | null>(null);
  const [epModalOpen, setEpModalOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [relatedMovies, setRelatedMovies] = useState<MovieSummary[]>([]);
  const [relatedLoadingId, setRelatedLoadingId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastChatId = useRef<string | null>(null);
  const initialLoaded = useRef(false);

  useEffect(() => {
    const onFsChange = () => {
      const nativeFs = Boolean(document.fullscreenElement);
      const active = nativeFs || pseudoFullscreen;
      setIsFullscreen(active);
      if (!active) {
        try {
          (screen.orientation as unknown as { unlock?: () => void })?.unlock?.();
        } catch {
          /* ignore */
        }
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [pseudoFullscreen]);

  const lockMobileLandscape = () => {
    const isMobile =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth <= 900);
    if (!isMobile) return;
    try {
      void (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })
        ?.lock?.('landscape')
        ?.catch(() => undefined);
    } catch {
      /* iOS Safari không hỗ trợ orientation.lock, sẽ dùng CSS fallback */
    }
  };

  const unlockMobileLandscape = () => {
    try {
      (screen.orientation as unknown as { unlock?: () => void })?.unlock?.();
    } catch {
      /* ignore */
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      unlockMobileLandscape();
      setPseudoFullscreen(false);
      setIsFullscreen(false);
      return;
    }
    if (pseudoFullscreen) {
      unlockMobileLandscape();
      setPseudoFullscreen(false);
      setIsFullscreen(false);
      return;
    }
    const el = stageRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }) | null;
    if (el?.requestFullscreen) {
      el.requestFullscreen()
        .then(() => {
          setIsFullscreen(true);
          lockMobileLandscape();
        })
        .catch(() => {
          setPseudoFullscreen(true);
          setIsFullscreen(true);
          lockMobileLandscape();
        });
    } else if (el?.webkitRequestFullscreen) {
      try {
        void el.webkitRequestFullscreen();
        setIsFullscreen(true);
        lockMobileLandscape();
      } catch {
        setPseudoFullscreen(true);
        setIsFullscreen(true);
        lockMobileLandscape();
      }
    } else {
      setPseudoFullscreen(true);
      setIsFullscreen(true);
      lockMobileLandscape();
    }
  };

  const titleParts = source?.title?.split(' · ') ?? [];
  const movieTitle = rememberedMovie?.title || titleParts[0] || source?.title || '';
  const episodeTitle = titleParts.length > 1 ? titleParts[titleParts.length - 1] : '';
  // Tập tiếp theo trong CÙNG bản (Vietsub -> Vietsub), sắp theo số tập chứ không theo thứ tự danh sách gốc
  const nextEp = useMemo(
    () =>
      rememberedMovie && source?.type === 'video' ? nextEpisode(rememberedMovie.episodes, source.url) : null,
    [rememberedMovie, source?.type, source?.url],
  );

  const handleNextEpisode = () => {
    if (!nextEp || !rememberedMovie || !connected) return;
    room.control('load', 0, toVideoSource(nextEp.url, `${rememberedMovie.title} · ${nextEp.name}`));
  };

  // Tự động tìm các phần tiếp theo / Movie cùng bộ (ví dụ Solo Leveling Phần 2, Movie...)
  useEffect(() => {
    if (!source || source.type !== 'video' || !movieTitle) {
      setRelatedMovies([]);
      return;
    }
    const baseTitle = extractFranchiseBase(movieTitle);
    const origBase = extractFranchiseBase(rememberedMovie?.originalTitle ?? '');
    if (baseTitle.length < 3 && origBase.length < 3) {
      setRelatedMovies([]);
      return;
    }
    let cancelled = false;
    const queries = Array.from(new Set([baseTitle, origBase].filter((q) => q.length >= 3)));
    Promise.allSettled(queries.map((q) => api.searchMovies(q, 1))).then((results) => {
      if (cancelled) return;
      const normBase = normalizeForMatch(baseTitle);
      const normOrig = normalizeForMatch(origBase);
      const normCurrentTitle = normalizeForMatch(movieTitle);
      const seen = new Set<string>();
      const matched: MovieSummary[] = [];

      for (const res of results) {
        if (res.status !== 'fulfilled') continue;
        for (const item of res.value.items) {
          if (seen.has(item.id)) continue;
          if (rememberedMovie && item.id === rememberedMovie.id) continue;
          const normItemTitle = normalizeForMatch(item.title);
          const normItemOrig = normalizeForMatch(item.originalTitle ?? '');
          if (normItemTitle === normCurrentTitle && !rememberedMovie) continue;

          const matchesBase =
            (normBase.length >= 3 && (normItemTitle.includes(normBase) || normItemOrig.includes(normBase))) ||
            (normOrig.length >= 3 && (normItemTitle.includes(normOrig) || normItemOrig.includes(normOrig)));

          if (matchesBase) {
            seen.add(item.id);
            matched.push(item);
          }
        }
      }
      setRelatedMovies(matched.slice(0, 8));
    });
    return () => {
      cancelled = true;
    };
  }, [source?.type, movieTitle, rememberedMovie?.id, rememberedMovie?.originalTitle]);

  const handlePickRelatedMovie = async (m: MovieSummary) => {
    if (!connected || relatedLoadingId) return;
    setRelatedLoadingId(m.id);
    try {
      const detail = await api.movieDetail(m.id);
      setRememberedMovie(detail);
      if (detail.episodes.length > 0) {
        const ep = detail.episodes[0];
        const label = detail.episodes.length > 1 ? `${detail.title} · ${ep.name}` : detail.title;
        room.control('load', 0, toVideoSource(ep.url, label));
      }
    } catch (e) {
      setPlayerError((e as Error).message);
    } finally {
      setRelatedLoadingId(null);
    }
  };

  // Chọn phim từ trang chủ -> chiếu ngay khi vào phòng (chỉ khi phòng chưa có gì)
  const { control, serverNow } = room;
  useEffect(() => {
    if (!connected || initialLoaded.current || !room.state) return;
    initialLoaded.current = true;
    if (navState.initialSource && !room.state.source) control('load', 0, navState.initialSource);
  }, [connected, room.state, navState.initialSource, control]);

  // Đổi video -> reset trình phát & tra cứu mốc Skip Intro/Outro (AniSkip)
  const { resetPlayer } = sync;
  useEffect(() => {
    resetPlayer();
    setPlayerError(null);
    setSkipSegments([]);
    setActiveSkip(null);
    if (!source || source.type !== 'video' || !source.title) return;

    const parts = source.title.split(' · ');
    const baseTitle = rememberedMovie?.title || parts[0] || source.title;
    const epLabel = parts.length > 1 ? parts[parts.length - 1] : '1';
    let cancelled = false;
    api
      .getSkipTimes(baseTitle, rememberedMovie?.originalTitle ?? '', epLabel)
      .then((segs) => {
        if (!cancelled) setSkipSegments(segs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source?.type, source?.url, source?.title, rememberedMovie?.title, rememberedMovie?.originalTitle, resetPlayer]);

  // Theo dõi mốc thời gian đang phát để bật nút "Bỏ qua giới thiệu" giống Netflix
  useEffect(() => {
    if (skipSegments.length === 0 || !room.state?.source) {
      setActiveSkip(null);
      return;
    }
    const update = () => {
      const st = room.state;
      if (!st?.source) {
        setActiveSkip(null);
        return;
      }
      const pos = st.playing ? st.position + Math.max(0, serverNow() - st.updatedAt) / 1000 : st.position;
      const match = skipSegments.find((seg) => pos >= seg.startTime && pos < seg.endTime - 1.5) ?? null;
      setActiveSkip(match);
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [skipSegments, room.state, serverNow]);

  useEffect(() => {
    if (!room.notice) return;
    setShowNotice(true);
    const t = setTimeout(() => setShowNotice(false), 4000);
    return () => clearTimeout(t);
  }, [room.notice]);

  // Giữ Render Free không bị ngủ giữa chừng khi cả phòng đang xem phim dài (chỉ ping khi đang ở trong phòng)
  useEffect(() => {
    if (!roomId) return;
    const ping = () => {
      void fetch(resolveApiUrl('/api/time'), { cache: 'no-store' }).catch(() => undefined);
    };
    const timer = window.setInterval(ping, 4 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [roomId]);

  // Tin nhắn chỉ có emoji -> thả emoji bay trên màn hình
  useEffect(() => {
    const last = room.chat[room.chat.length - 1];
    if (!last || last.id === lastChatId.current) return;
    lastChatId.current = last.id;
    if (last.type !== 'USER' || !isEmojiOnly(last.text) || serverNow() - last.timestamp > 3000) return;
    const f = { id: last.id, emoji: last.text, left: 10 + Math.random() * 80 };
    setFloats((list) => [...list, f]);
    setTimeout(() => setFloats((list) => list.filter((x) => x.id !== f.id)), 2600);
  }, [room.chat, serverNow]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${id}`);
    } catch {
      /* clipboard bị chặn */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const enter = async (e: FormEvent) => {
    e.preventDefault();
    const n = draftName.trim();
    if (!n) return;
    if (roomMeta?.hasPin) {
      const candidate = draftPin.trim();
      if (!candidate) {
        setPinError('Vui lòng nhập mã PIN / mật khẩu của phòng.');
        return;
      }
      setVerifyingPin(true);
      setPinError(null);
      try {
        const res = await api.verifyRoomPin(id, candidate);
        setVerifyingPin(false);
        if (!res.ok) {
          setPinError('Mã PIN / mật khẩu không đúng!');
          return;
        }
        setPin(candidate);
        setPinVerified(true);
      } catch (err) {
        setVerifyingPin(false);
        setPinError((err as Error).message);
        return;
      }
    }
    saveName(n);
    setName(n);
  };

  if (exists === false) {
    return (
      <main className="center-page">
        <div className="ticket">
          <Logo />
          <h1>Không tìm thấy phòng</h1>
          <p className="muted">Phòng {id} không tồn tại hoặc đã đóng.</p>
          <Link className="btn btn-primary block" to="/">
            Về trang chủ
          </Link>
        </div>
      </main>
    );
  }

  if (exists && !canConnect) {
    return (
      <main className="center-page">
        <form className="ticket" onSubmit={enter}>
          <Logo />
          <div className="ticket-stub">
            <span className="kicker">{roomMeta?.hasPin ? '🔒 Phòng khoá PIN' : 'Vé vào phòng'}</span>
            <strong className="ticket-code" title={roomMeta?.title || id}>
              {roomMeta?.title || id}
            </strong>
            {roomMeta?.title && <span className="ticket-id">#{id}</span>}
          </div>
          <h1>{roomMeta?.hasPin ? 'Nhập tên & Mã PIN' : 'Bạn tên gì?'}</h1>
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Tên hiển thị của bạn"
            maxLength={30}
            autoFocus
            aria-label="Tên hiển thị"
          />
          {roomMeta?.hasPin && (
            <input
              type="password"
              value={draftPin}
              onChange={(e) => {
                setDraftPin(e.target.value);
                setPinError(null);
              }}
              placeholder="🔒 Mã PIN / mật khẩu phòng"
              maxLength={12}
              aria-label="Mã PIN phòng"
            />
          )}
          {pinError && <p className="error-text">{pinError}</p>}
          <button className="btn btn-primary btn-lg block" disabled={!draftName.trim() || verifyingPin}>
            ▶ {verifyingPin ? 'Đang kiểm tra…' : 'Vào phòng chiếu'}
          </button>
        </form>
      </main>
    );
  }

  const ambient = source?.type === 'youtube' ? `https://i.ytimg.com/vi/${source.url}/hqdefault.jpg` : null;

  return (
    <div className={`room ${chatOpen ? '' : 'theater'}`}>
      <header className="room-header">
        <Logo />
        <div className="room-pill">
          <span className="kicker">{room.hasPin || roomMeta?.hasPin ? '🔒 Phòng' : 'Phòng'}</span>
          <strong className="room-pill-title" title={room.roomTitle || roomMeta?.title || id}>
            {room.roomTitle || roomMeta?.title || id}
          </strong>
          <span className="room-pill-code">#{id}</span>
          <button className="pill-btn" onClick={copyLink}>
            {copied ? 'Đã chép ✓' : 'Mời bạn'}
          </button>
        </div>

        <div className="room-header-right">
          <div className="members" title={room.members.map((m) => m.name).join(', ')}>
            <div className="avatar-stack">
              {room.members.slice(0, 5).map((m) => {
                const talking = Boolean(voice.speakingIds[m.id]);
                return (
                  <span
                    key={m.id}
                    className={`avatar ${talking ? 'speaking-ring' : ''}`}
                    style={{ background: colorFor(m.name) }}
                  >
                    {initials(m.name)}
                  </span>
                );
              })}
            </div>
            <span className="members-count">
              <span className={`status-dot ${connected ? 'ok' : 'warn'}`} />
              {connected ? `${room.members.length} đang xem` : 'Đang kết nối…'}
            </span>
          </div>
          <button
            type="button"
            className={`voice-header-pill ${voice.inVoice ? 'connected' : ''}`}
            disabled={!connected}
            onClick={() => {
              if (!voice.inVoice) {
                void voice.joinVoice();
                setChatOpen(true);
              } else {
                voice.toggleMute();
              }
            }}
            title={
              voice.inVoice
                ? voice.muted
                  ? 'Đang ở Voice (Đã tắt Mic) — bấm để bật Mic'
                  : 'Đang ở Voice (Mic đang bật) — bấm để tắt Mic'
                : 'Tham gia Voice Chat'
            }
          >
            <span>{voice.inVoice ? (voice.muted ? '🔇' : '🎙️') : '🎧'}</span>
            <span>{voice.inVoice ? (voice.muted ? 'Đã tắt Mic' : 'Voice ON') : 'Voice Chat'}</span>
          </button>
          <button
            className={`icon-btn ${chatOpen ? 'active' : ''}`}
            onClick={() => setChatOpen((o) => !o)}
            aria-pressed={chatOpen}
            title={chatOpen ? 'Chế độ rạp (ẩn chat)' : 'Hiện chat'}
          >
            💬
          </button>
        </div>
      </header>

      {room.error && (
        <div className="toast" role="alert">
          {room.error}
          <button className="btn btn-ghost small" onClick={room.clearError}>
            Đóng
          </button>
        </div>
      )}

      <main className="room-main">
        <div className="stage-col">
          <div className="screen-wrap">
            <div
              className="ambient"
              style={ambient ? { backgroundImage: `url(${ambient})` } : undefined}
              aria-hidden="true"
            />
            <div className={`stage ${pseudoFullscreen ? 'pseudo-fullscreen' : ''}`} ref={stageRef}>
              {source ? (
                <VideoPlayer
                  source={source}
                  {...sync.playerCallbacks}
                  onBlocked={sync.onBlocked}
                  onError={setPlayerError}
                  movieTitle={movieTitle}
                  episodeTitle={episodeTitle}
                  hasEpisodes={Boolean(rememberedMovie && rememberedMovie.episodes.length > 0)}
                  onOpenEpisodes={() => setEpModalOpen(true)}
                  hasNextEpisode={Boolean(nextEp)}
                  onNextEpisode={handleNextEpisode}
                  onToggleFullscreen={toggleFullscreen}
                  isFullscreen={isFullscreen}
                />
              ) : (
                <div className="stage-empty">
                  <div className="curtain left" aria-hidden="true" />
                  <div className="curtain right" aria-hidden="true" />
                  <div className="stage-empty-content">
                    <span className="kicker">Sắp chiếu</span>
                    <p className="stage-empty-title">Màn hình đang chờ</p>
                    <p className="muted">Dán link YouTube hoặc chọn phim trong kho ở bên dưới.</p>
                  </div>
                </div>
              )}

              {sync.needsGesture && !playerError && (
                <button className="stage-overlay" onClick={sync.resumeWithGesture}>
                  <span className="play-big">▶</span>
                  Bấm để xem cùng mọi người
                </button>
              )}
              {playerError && (
                <div className="stage-overlay error">
                  <p>{playerError}</p>
                </div>
              )}

              {activeSkip && source && !sync.needsGesture && !playerError && (
                <button
                  type="button"
                  className="skip-intro-btn"
                  onClick={() => room.control('seek', Math.ceil(activeSkip.endTime), source)}
                >
                  {activeSkip.type === 'op' ? '⏭ Bỏ qua giới thiệu' : '⏭ Bỏ qua kết thúc'}
                </button>
              )}

              <div className="floats" aria-hidden="true">
                {floats.map((f) => (
                  <span key={f.id} className="float-emoji" style={{ left: `${f.left}%` }}>
                    {f.emoji}
                  </span>
                ))}
              </div>

              {epModalOpen && (
                <MovieLibrary
                  initialDetail={rememberedMovie}
                  playingUrl={source?.type === 'video' ? source.url : undefined}
                  onRememberDetail={setRememberedMovie}
                  onPick={(s, detail) => {
                    if (detail) setRememberedMovie(detail);
                    if (connected) room.control('load', 0, s);
                    setEpModalOpen(false);
                  }}
                  onClose={() => setEpModalOpen(false)}
                />
              )}
            </div>
          </div>

          <div className="now-playing">
            <div className="np-title">
              <span className="kicker">
                {source ? (
                  <>
                    <span className="live-dot" /> Đang chiếu · {source.type === 'youtube' ? 'YouTube' : 'Video'}
                  </>
                ) : (
                  'Chưa chọn phim'
                )}
              </span>
              <h1>{source?.title ?? 'Chọn một bộ phim để bắt đầu'}</h1>
            </div>
            <span className={`np-notice ${showNotice ? 'show' : ''}`}>{room.notice?.text}</span>
          </div>

          <SourcePicker
            disabled={!connected}
            rememberedMovie={rememberedMovie}
            playingUrl={source?.type === 'video' ? source.url : undefined}
            onRememberMovie={setRememberedMovie}
            onLoad={(s) => room.control('load', 0, s)}
          />

          {relatedMovies.length > 0 && (
            <section className="related-franchise-sec" aria-label="Phần tiếp theo và phim cùng bộ">
              <div className="related-head">
                <div>
                  <span className="kicker">✦ Đề xuất theo phim đang chiếu</span>
                  <h2 className="related-title">🎬 Phần tiếp theo &amp; Phim cùng bộ</h2>
                </div>
              </div>
              <div className="related-row">
                {relatedMovies.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="related-card"
                    disabled={!connected || relatedLoadingId === m.id}
                    onClick={() => void handlePickRelatedMovie(m)}
                  >
                    <div className="related-poster">
                      {m.poster ? <img src={m.poster} alt={m.title} loading="lazy" /> : <div className="poster-fallback">🎬</div>}
                      {m.currentEpisode && <span className="related-ep-badge">{m.currentEpisode}</span>}
                    </div>
                    <div className="related-info">
                      <strong className="related-name">{m.title}</strong>
                      <span className="related-meta">
                        {[m.year, m.quality].filter(Boolean).join(' · ') || 'Chiếu ngay'}
                      </span>
                      <span className="related-cta">
                        {relatedLoadingId === m.id ? 'Đang tải…' : '▶ Chuyển sang phần này'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {chatOpen && (
          <aside className="side-col" aria-label="Kênh thoại và trò chuyện">
            <VoicePanel me={room.me} members={room.members} connected={connected} voice={voice} />
            <Chat
              messages={room.chat}
              myName={name ?? ''}
              memberCount={room.members.length}
              onSend={room.sendChat}
              disabled={!connected}
            />
          </aside>
        )}
      </main>
    </div>
  );
}
