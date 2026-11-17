import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EpisodePicker } from '../components/EpisodePicker';
import { Logo } from '../components/Logo';
import { VideoPlayer } from '../components/VideoPlayer';
import { groupEpisodes, nextEpisode } from '../episodes';
import { useStageFullscreen } from '../hooks/useStageFullscreen';
import { getProgress, isNearEnd, removeProgress, saveProgress } from '../progress';
import type { MovieDetail, PlayerHandle } from '../types';
import { formatTime, loadName, toVideoSource } from '../utils';

/**
 * Xem một mình: không tạo phòng, không WebSocket — chỉ có trình phát.
 * Tự nhớ tập & giây đang xem để lần sau "Xem tiếp"; muốn rủ bạn thì bấm "Mời bạn xem cùng"
 * để mở phòng tiếp đúng tập, đúng giây.
 */
export function WatchPage() {
  const { movieId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<MovieDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const handleRef = useRef<PlayerHandle | null>(null);
  /** Vị trí sẽ tua tới khi trình phát sẵn sàng (xem tiếp). */
  const resumeRef = useRef(0);
  /** Vị trí / độ dài đọc gần nhất — dùng khi lưu, vì lúc rời trang trình phát có thể đã bị huỷ. */
  const lastRef = useRef({ pos: 0, dur: 0 });
  const episodesRef = useRef<HTMLElement>(null);
  const { ref: stageRef, isFullscreen, pseudo, toggle: toggleFullscreen } = useStageFullscreen<HTMLDivElement>();

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    api
      .movieDetail(movieId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [movieId]);

  // Tập đang xem: ?tap=<vị trí> -> tập đang xem dở -> tập đầu của bản đầu tiên (Vietsub)
  const epIndex = useMemo(() => {
    if (!detail || detail.episodes.length === 0) return -1;
    const fromUrl = params.get('tap');
    const n = fromUrl === null ? NaN : Number(fromUrl);
    if (Number.isInteger(n) && n >= 0 && n < detail.episodes.length) return n;
    const saved = getProgress(detail.id);
    if (saved && saved.epIndex >= 0 && saved.epIndex < detail.episodes.length) return saved.epIndex;
    return groupEpisodes(detail.episodes)[0]?.episodes[0]?.index ?? 0;
  }, [detail, params]);

  const ep = detail && epIndex >= 0 ? detail.episodes[epIndex] : null;
  const multi = (detail?.episodes.length ?? 0) > 1;
  const source = useMemo(
    () => (detail && ep ? toVideoSource(ep.url, multi ? `${detail.title} · ${ep.name}` : detail.title) : null),
    [detail, ep, multi],
  );
  const next = useMemo(() => (detail && ep ? nextEpisode(detail.episodes, ep.url) : null), [detail, ep]);

  // Đổi tập -> tính lại vị trí xem tiếp
  useEffect(() => {
    if (!detail || !ep) return;
    const saved = getProgress(detail.id);
    const t = Number(params.get('t'));
    resumeRef.current =
      Number.isFinite(t) && t > 0
        ? t
        : saved && saved.epIndex === epIndex && !isNearEnd(saved.position, saved.duration)
          ? saved.position
          : 0;
    lastRef.current = { pos: resumeRef.current, dur: 0 };
    handleRef.current = null;
    setPlayerError(null);
    setNeedsTap(false);
    document.title = `${detail.title}${multi && ep ? ` · ${ep.name}` : ''} – Xem Cùng`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, epIndex]);

  useEffect(() => () => void (document.title = 'Xem Cùng'), []);

  const save = useCallback(() => {
    if (!detail || !ep) return;
    const { pos, dur } = lastRef.current;
    if (isNearEnd(pos, dur)) {
      // Xem gần hết: phim bộ thì nhớ sang tập kế, phim lẻ thì xoá khỏi "Tiếp tục xem"
      const nxt = nextEpisode(detail.episodes, ep.url);
      if (nxt) {
        saveProgress({
          movieId: detail.id,
          title: detail.title,
          poster: detail.poster,
          epIndex: detail.episodes.indexOf(nxt),
          epName: nxt.name,
          multiEpisode: true,
          position: 0,
          duration: 0,
        });
      } else {
        removeProgress(detail.id);
      }
      return;
    }
    saveProgress({
      movieId: detail.id,
      title: detail.title,
      poster: detail.poster,
      epIndex,
      epName: multi ? ep.name : '',
      multiEpisode: multi,
      position: pos,
      duration: dur,
    });
  }, [detail, ep, epIndex, multi]);

  // Đọc vị trí mỗi giây, lưu mỗi 5 giây khi đang phát, và lưu khi rời trang / đổi tập
  useEffect(() => {
    let tick = 0;
    const timer = window.setInterval(() => {
      const h = handleRef.current;
      if (!h) return;
      const pos = h.getTime();
      const dur = h.getDuration?.() ?? 0;
      if (Number.isFinite(pos) && pos > 0) lastRef.current = { pos, dur: dur || lastRef.current.dur };
      if (h.isPlaying() && ++tick % 5 === 0) save();
    }, 1000);
    const onHide = () => save();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  }, [save]);

  const goToEpisode = (index: number) => {
    if (!detail || index < 0) return;
    save();
    setParams({ tap: String(index) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const playerCallbacks = {
    onReady: (h: PlayerHandle) => {
      handleRef.current = h;
      if (resumeRef.current > 1) h.seek(resumeRef.current);
      h.play();
    },
    onPlay: () => setNeedsTap(false),
    onPause: (t: number) => {
      if (t > 0) lastRef.current = { ...lastRef.current, pos: t };
      save();
    },
    onSeek: (t: number) => {
      if (t > 0) lastRef.current = { ...lastRef.current, pos: t };
    },
    onBlocked: () => setNeedsTap(true),
    onError: (msg: string) => setPlayerError(msg),
  };

  /** Rủ bạn: tạo phòng, chép link mời, chuyển sang phòng tiếp tục đúng tập & đúng giây. */
  const inviteFriends = async () => {
    if (!detail || !source) return;
    setInviting(true);
    const position = Math.floor(handleRef.current?.getTime() ?? lastRef.current.pos);
    try {
      save();
      const room = await api.createRoom(`Phòng xem ${detail.title}`, '');
      try {
        await navigator.clipboard.writeText(`${location.origin}/room/${room.id}`);
      } catch {
        /* không chép được thì trong phòng vẫn có nút "Mời bạn" */
      }
      navigate(`/room/${room.id}`, {
        state: {
          name: loadName() || undefined,
          initialSource: source,
          initialMovieDetail: detail,
          initialPosition: position,
          copiedInvite: true,
        },
      });
    } catch (e) {
      setToast((e as Error).message);
      setInviting(false);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (error) {
    return (
      <main className="center-page">
        <div className="ticket">
          <Logo />
          <h1>Không mở được phim</h1>
          <p className="muted">{error}</p>
          <Link className="btn btn-primary block" to="/">
            Về trang chủ
          </Link>
        </div>
      </main>
    );
  }

  const meta = [detail?.year, multi && ep ? ep.name : null].filter(Boolean).join(' · ');

  return (
    <div className="watch">
      <header className="watch-top">
        <Link to="/" className="watch-back" aria-label="Về trang chủ">
          ←
        </Link>
        <Logo />
        <span className="watch-solo-badge">Xem một mình</span>
        <button className="btn btn-primary watch-invite" onClick={() => void inviteFriends()} disabled={!source || inviting}>
          👥{' '}
          {inviting ? (
            'Đang mở…'
          ) : (
            <>
              <span className="lbl-full">Mời bạn xem cùng</span>
              <span className="lbl-short">Mời bạn</span>
            </>
          )}
        </button>
      </header>

      <main className="watch-main">
        <div className={`stage watch-stage ${pseudo ? 'pseudo-fullscreen' : ''}`} ref={stageRef}>
          {source ? (
            <VideoPlayer
              source={source}
              {...playerCallbacks}
              movieTitle={detail?.title}
              episodeTitle={multi ? ep?.name : undefined}
              hasEpisodes={multi}
              onOpenEpisodes={() => {
                if (isFullscreen) toggleFullscreen();
                episodesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              hasNextEpisode={Boolean(next)}
              onNextEpisode={() => next && goToEpisode(detail!.episodes.indexOf(next))}
              onToggleFullscreen={toggleFullscreen}
              isFullscreen={isFullscreen}
            />
          ) : (
            <div className="stage-empty">
              {detail && detail.episodes.length === 0 ? (
                <p className="muted">Phim này chưa có bản phát được.</p>
              ) : (
                <div className="spinner" aria-label="Đang tải" />
              )}
            </div>
          )}

          {needsTap && !playerError && (
            <button
              className="stage-overlay"
              onClick={() => {
                setNeedsTap(false);
                handleRef.current?.play();
              }}
            >
              <span className="play-big">▶</span>
              {resumeRef.current > 1 ? `Xem tiếp từ ${formatTime(resumeRef.current)}` : 'Bấm để phát'}
            </button>
          )}
          {playerError && (
            <div className="stage-overlay error">
              <p>{playerError}</p>
            </div>
          )}
        </div>

        {detail && (
          <section className="watch-info">
            <span className="kicker">
              <span className="live-dot" /> Đang xem
            </span>
            <h1>{detail.title}</h1>
            {meta && <p className="watch-meta">{meta}</p>}
            {detail.description && <p className="watch-desc">{detail.description}</p>}
            <p className="watch-tip muted small">
              💡 Muốn xem cùng bạn bè? Bấm <strong>Mời bạn xem cùng</strong> — phòng sẽ mở tiếp đúng đoạn bạn đang xem và
              link mời được chép sẵn.
            </p>
          </section>
        )}

        {detail && multi && (
          <section className="watch-episodes" ref={episodesRef} aria-label="Danh sách tập">
            <h2 className="row-title">Danh sách tập</h2>
            <EpisodePicker
              key={detail.id}
              episodes={detail.episodes}
              playingUrl={ep?.url}
              onPick={(e) => goToEpisode(detail.episodes.indexOf(e))}
            />
          </section>
        )}
      </main>

      {toast && (
        <div className="toast" role="alert">
          {toast}
        </div>
      )}
    </div>
  );
}
