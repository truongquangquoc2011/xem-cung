import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api';
import { Chat } from '../components/Chat';
import { Logo } from '../components/Logo';
import { MovieLibrary } from '../components/MovieLibrary';
import { SourcePicker } from '../components/SourcePicker';
import { VideoPlayer } from '../components/VideoPlayer';
import { usePlaybackSync } from '../hooks/usePlaybackSync';
import { useRoom } from '../hooks/useRoom';
import type { MovieDetail, SkipSegment, VideoSource } from '../types';
import { colorFor, initials, isEmojiOnly, loadName, saveName, toVideoSource } from '../utils';

interface FloatingEmoji {
  id: string;
  emoji: string;
  left: number;
}

interface NavState {
  name?: string;
  initialSource?: VideoSource;
  initialMovieDetail?: MovieDetail;
}

export function RoomPage() {
  const { roomId = '' } = useParams();
  const id = roomId.toUpperCase();
  const location = useLocation();
  const navState = (location.state as NavState | null) ?? {};

  const [exists, setExists] = useState<boolean | null>(null);
  const [name, setName] = useState<string | null>(navState.name ?? null);
  const [draftName, setDraftName] = useState(loadName());

  useEffect(() => {
    api
      .getRoom(id)
      .then(() => setExists(true))
      .catch(() => setExists(false));
  }, [id]);

  const room = useRoom(id, exists ? name : null);
  const sync = usePlaybackSync({ state: room.state, serverNow: room.serverNow, control: room.control });
  const source = room.state?.source;
  const connected = room.status === 'connected' && room.me !== null;

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
  const stageRef = useRef<HTMLDivElement>(null);
  const lastChatId = useRef<string | null>(null);
  const initialLoaded = useRef(false);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      stageRef.current?.requestFullscreen().catch(() => undefined);
    }
  };

  const titleParts = source?.title?.split(' · ') ?? [];
  const movieTitle = rememberedMovie?.title || titleParts[0] || source?.title || '';
  const episodeTitle = titleParts.length > 1 ? titleParts[titleParts.length - 1] : '';
  const currentEpIndex =
    rememberedMovie && source?.type === 'video'
      ? rememberedMovie.episodes.findIndex((ep) => ep.url === source.url)
      : -1;
  const nextEp =
    rememberedMovie && currentEpIndex >= 0 && currentEpIndex + 1 < rememberedMovie.episodes.length
      ? rememberedMovie.episodes[currentEpIndex + 1]
      : null;

  const handleNextEpisode = () => {
    if (!nextEp || !rememberedMovie || !connected) return;
    room.control('load', 0, toVideoSource(nextEp.url, `${rememberedMovie.title} · ${nextEp.name}`));
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

  const enter = (e: FormEvent) => {
    e.preventDefault();
    const n = draftName.trim();
    if (!n) return;
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

  if (exists && !name) {
    return (
      <main className="center-page">
        <form className="ticket" onSubmit={enter}>
          <Logo />
          <div className="ticket-stub">
            <span className="kicker">Vé vào phòng</span>
            <strong className="ticket-code">{id}</strong>
          </div>
          <h1>Bạn tên gì?</h1>
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Tên hiển thị"
            maxLength={30}
            autoFocus
            aria-label="Tên hiển thị"
          />
          <button className="btn btn-primary btn-lg block" disabled={!draftName.trim()}>
            ▶ Vào phòng chiếu
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
          <span className="kicker">Phòng</span>
          <strong>{id}</strong>
          <button className="pill-btn" onClick={copyLink}>
            {copied ? 'Đã chép ✓' : 'Chép link mời'}
          </button>
        </div>

        <div className="room-header-right">
          <div className="members" title={room.members.map((m) => m.name).join(', ')}>
            <div className="avatar-stack">
              {room.members.slice(0, 5).map((m) => (
                <span key={m.id} className="avatar" style={{ background: colorFor(m.name) }}>
                  {initials(m.name)}
                </span>
              ))}
            </div>
            <span className="members-count">
              <span className={`status-dot ${connected ? 'ok' : 'warn'}`} />
              {connected ? `${room.members.length} đang xem` : 'Đang kết nối…'}
            </span>
          </div>
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
            <div className="stage" ref={stageRef}>
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
        </div>

        {chatOpen && (
          <Chat
            messages={room.chat}
            myName={name ?? ''}
            memberCount={room.members.length}
            onSend={room.sendChat}
            disabled={!connected}
          />
        )}
      </main>
    </div>
  );
}
