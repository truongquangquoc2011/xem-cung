import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { EpisodePicker } from '../components/EpisodePicker';
import { Logo } from '../components/Logo';
import { PosterRow } from '../components/PosterRow';
import { HOT_PERIODS, MOVIE_CATEGORIES, type HotPeriod } from '../constants/movies';
import type { MovieDetail, MoviePage, MovieSummary, RoomSummary, VideoSource } from '../types';
import { loadName, saveName, toVideoSource } from '../utils';

export function HomePage() {
  const navigate = useNavigate();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState('');
  const [roomTitleInput, setRoomTitleInput] = useState('');
  const [roomPinInput, setRoomPinInput] = useState('');
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [pinModalRoom, setPinModalRoom] = useState<RoomSummary | null>(null);
  const [joinPinInput, setJoinPinInput] = useState('');
  const [joinPinError, setJoinPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popular, setPopular] = useState<MovieSummary[]>([]);
  const [more, setMore] = useState<MovieSummary[]>([]);
  const [scrolled, setScrolled] = useState(false);

  // Tìm kiếm & lọc thể loại ngay trên trang chủ
  const [searchInput, setSearchInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [browsePage, setBrowsePage] = useState(1);
  const [browseData, setBrowseData] = useState<MoviePage | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  // Phim hot theo thời gian (today / week / month)
  const [hotPeriod, setHotPeriod] = useState<HotPeriod>('today');
  const [hotItems, setHotItems] = useState<MovieSummary[]>([]);
  const [hotLoading, setHotLoading] = useState(false);

  // Chọn tập cho phim nhiều tập trước khi tạo phòng
  const [pickedDetail, setPickedDetail] = useState<MovieDetail | null>(null);

  // Hero carousel ưu tiên phim Việt Nam & Anime nổi bật
  interface HeroSlide {
    movie: MovieSummary;
    tag: 'viet-nam' | 'hoat-hinh';
    tagLabel: string;
  }
  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>([]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [heroDetails, setHeroDetails] = useState<Record<string, MovieDetail>>({});

  const refreshRooms = () => {
    // Tab đang ẩn thì không gọi (đỡ tốn mạng / pin điện thoại)
    if (document.hidden) return;
    api.listRooms().then(setRooms).catch(() => {});
  };

  useEffect(() => {
    refreshRooms();
    const roomTimer = window.setInterval(refreshRooms, 8000);
    api.searchMovies('', 1).then((p) => setPopular(p.items)).catch(() => {});
    api.searchMovies('', 2).then((p) => setMore(p.items)).catch(() => {});
    Promise.allSettled([
      api.searchMovies('', 1, 'viet-nam', ''),
      api.searchMovies('', 1, 'hoat-hinh', ''),
    ]).then(([vnRes, animeRes]) => {
      const vnList = vnRes.status === 'fulfilled' ? vnRes.value.items.slice(0, 3) : [];
      const animeList = animeRes.status === 'fulfilled' ? animeRes.value.items.slice(0, 3) : [];
      const combined: HeroSlide[] = [];
      const maxLen = Math.max(vnList.length, animeList.length);
      for (let i = 0; i < maxLen; i++) {
        if (vnList[i]) combined.push({ movie: vnList[i], tag: 'viet-nam', tagLabel: 'Phim Việt Nam' });
        if (animeList[i]) combined.push({ movie: animeList[i], tag: 'hoat-hinh', tagLabel: 'Anime Nổi Bật' });
      }
      setHeroSlides(combined);
    });
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearInterval(roomTimer);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Chỉ tải chi tiết phim đang hiện trên banner (trước đây tải cùng lúc cả 6 phim)
  const activeHeroId = heroSlides[heroIndex]?.movie.id;
  useEffect(() => {
    if (!activeHeroId || heroDetails[activeHeroId]) return;
    let cancelled = false;
    api
      .movieDetail(activeHeroId)
      .then((d) => !cancelled && setHeroDetails((prev) => ({ ...prev, [activeHeroId]: d })))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeHeroId, heroDetails]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) refreshRooms();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (heroSlides.length <= 1 || heroPaused) return;
    const timer = window.setInterval(() => {
      setHeroIndex((i) => (i + 1) % heroSlides.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [heroSlides.length, heroPaused]);

  useEffect(() => {
    let cancelled = false;
    setHotLoading(true);
    api
      .searchMovies('', 1, '', hotPeriod)
      .then((p) => {
        if (!cancelled) setHotItems(p.items);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hotPeriod]);

  const isBrowsing = submittedQuery !== '' || selectedCategory !== '';

  useEffect(() => {
    if (!isBrowsing) {
      setBrowseData(null);
      return;
    }
    let cancelled = false;
    setBrowseLoading(true);
    api
      .searchMovies(submittedQuery, browsePage, selectedCategory, '')
      .then((p) => {
        if (!cancelled) setBrowseData(p);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBrowseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isBrowsing, submittedQuery, selectedCategory, browsePage]);

  const activeSlide = heroSlides[heroIndex] ?? (popular[0] ? { movie: popular[0], tag: 'hoat-hinh' as const, tagLabel: 'Nổi bật' } : null);
  const activeDetail = activeSlide ? heroDetails[activeSlide.movie.id] : undefined;
  const heroBg = activeSlide?.movie.backdrop || activeSlide?.movie.poster;

  const requireName = () => {
    const n = name.trim();
    if (!n) {
      setError('Nhập tên của bạn trước nhé.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      nameRef.current?.focus();
      return null;
    }
    saveName(n);
    return n;
  };

  const createRoom = async (
    busyKey: string,
    initialSource?: VideoSource,
    initialMovieDetail?: MovieDetail,
  ) => {
    const n = requireName();
    if (!n) return;
    setBusy(busyKey);
    setError(null);
    try {
      const customTitle = roomTitleInput.trim() || (initialMovieDetail ? `Phòng xem ${initialMovieDetail.title}` : `Phòng của ${n}`);
      const customPin = roomPinInput.trim();
      const created = await api.createRoom(customTitle, customPin);
      navigate(`/room/${created.id}`, {
        state: { name: n, pin: customPin, initialSource, initialMovieDetail },
      });
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const enterExistingRoom = (room: RoomSummary) => {
    const n = requireName();
    if (!n) return;
    if (room.hasPin) {
      setJoinPinInput('');
      setJoinPinError(null);
      setPinModalRoom(room);
      return;
    }
    navigate(`/room/${room.id}`, { state: { name: n } });
  };

  const submitPinJoin = async (e: FormEvent) => {
    e.preventDefault();
    if (!pinModalRoom) return;
    const n = requireName();
    if (!n) return;
    const candidate = joinPinInput.trim();
    if (!candidate) {
      setJoinPinError('Vui lòng nhập mã PIN / mật khẩu phòng.');
      return;
    }
    setBusy('pin-verify');
    setJoinPinError(null);
    try {
      const res = await api.verifyRoomPin(pinModalRoom.id, candidate);
      setBusy(null);
      if (!res.ok) {
        setJoinPinError('Mã PIN / mật khẩu không đúng!');
        return;
      }
      const targetId = pinModalRoom.id;
      setPinModalRoom(null);
      navigate(`/room/${targetId}`, { state: { name: n, pin: candidate } });
    } catch (err) {
      setBusy(null);
      setJoinPinError((err as Error).message);
    }
  };

  /** Chọn phim -> nếu có 1 tập chiếu luôn, nếu nhiều tập thì mở bảng chọn tập trước khi vào phòng. */
  const watchMovie = async (m: MovieSummary) => {
    if (!requireName()) return;
    setBusy(m.id);
    setError(null);
    try {
      const d = await api.movieDetail(m.id);
      if (d.episodes.length === 0) throw new Error('Phim này chưa có bản phát được.');
      if (d.episodes.length === 1) {
        const ep = d.episodes[0];
        await createRoom(m.id, toVideoSource(ep.url, d.title), d);
        return;
      }
            setPickedDetail(d);
      setBusy(null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const n = requireName();
    if (!n) return;
    const id = code.trim().split('/').pop()?.toUpperCase() ?? '';
    if (!id) return;
    setBusy('join');
    setError(null);
    try {
      const room = await api.getRoom(id);
      setBusy(null);
      enterExistingRoom(room);
    } catch {
      setError(`Không tìm thấy phòng ${id}.`);
      setBusy(null);
    }
  };

  const submitHomeSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    setSelectedCategory('');
    setBrowsePage(1);
    setSubmittedQuery(q);
  };

  const selectHomeCategory = (slug: string) => {
    setSubmittedQuery('');
    setSearchInput('');
    setBrowsePage(1);
    setSelectedCategory(slug);
  };

  return (
    <div className="home">
      <nav className={`topnav ${scrolled ? 'solid' : ''}`}>
        <Logo size="lg" />
        <form className="nav-join" onSubmit={join}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Nhập mã phòng"
            aria-label="Mã phòng hoặc link mời"
          />
          <button className="btn btn-outline" disabled={!!busy || !code.trim()}>
            Vào phòng
          </button>
        </form>
      </nav>

      <header
        className="hero hero-cinema"
        onMouseEnter={() => setHeroPaused(true)}
        onMouseLeave={() => setHeroPaused(false)}
      >
        <div
          key={activeSlide?.movie.id ?? 'default'}
          className="hero-backdrop"
          style={heroBg ? { backgroundImage: `url(${heroBg})` } : undefined}
          aria-hidden="true"
        />
        <div className="hero-shade" aria-hidden="true" />

        <div className="hero-content hero-cinema-content">
          <div className="hero-badges">
            {activeSlide?.tag === 'viet-nam' ? (
              <span className="hero-badge vn">★ {activeSlide.tagLabel}</span>
            ) : (
              <span className="hero-badge anime">✦ {activeSlide?.tagLabel ?? 'Phòng chiếu online'}</span>
            )}
            <span className="kicker">
              <span className="live-dot" /> Xem chung đồng bộ
            </span>
          </div>

          <h1 className="hero-movie-title">
            {activeSlide?.movie.title ?? (
              <>
                Xem phim cùng nhau, <em>dù ở xa.</em>
              </>
            )}
          </h1>

          {activeSlide && (
            <p className="hero-meta">
              {[
                activeSlide.movie.year,
                activeSlide.movie.currentEpisode || (activeDetail?.episodes.length ? `${activeDetail.episodes.length} tập` : ''),
                activeSlide.movie.quality,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          <p className="hero-desc">
            {activeDetail?.description ||
              'Tạo phòng, gửi link cho bạn bè. Ai bấm dừng hay tua, cả phòng cùng theo. Vừa xem vừa trò chuyện như ngồi chung một rạp.'}
          </p>

          <div className="hero-actions">
            {activeSlide && (
              <>
                <button
                  type="button"
                  className="btn btn-play-hero"
                  disabled={!!busy}
                  onClick={() => watchMovie(activeSlide.movie)}
                >
                  <span aria-hidden="true">▶</span> {busy === activeSlide.movie.id ? 'Đang mở…' : 'Phát ngay'}
                </button>
                <button
                  type="button"
                  className="btn btn-info-hero"
                  disabled={!!busy}
                  onClick={async () => {
                    if (activeDetail) {
                                            setPickedDetail(activeDetail);
                    } else {
                      await watchMovie(activeSlide.movie);
                    }
                  }}
                >
                  ⓘ Thông tin &amp; Tập
                </button>
              </>
            )}
          </div>

          <div className="hero-room-bar">
            <p className="room-bar-label">Mở phòng chiếu của bạn</p>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="Tên của bạn…"
              maxLength={30}
              aria-label="Tên của bạn"
            />
            <input
              value={roomTitleInput}
              onChange={(e) => setRoomTitleInput(e.target.value)}
              placeholder="Tên phòng (tuỳ chọn)…"
              maxLength={50}
              aria-label="Tên phòng tuỳ chọn"
              className="room-opt-input"
            />
            <input
              type="password"
              value={roomPinInput}
              onChange={(e) => setRoomPinInput(e.target.value)}
              placeholder="🔒 Mã PIN (nếu muốn khoá)"
              maxLength={12}
              aria-label="Mã PIN phòng tuỳ chọn"
              className="room-pin-input"
            />
            <button className="btn btn-primary" onClick={() => createRoom('create')} disabled={!!busy}>
              + {busy === 'create' ? 'Đang tạo…' : roomPinInput.trim() ? 'Tạo phòng khoá PIN' : 'Tạo phòng mới'}
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
        </div>

        {heroSlides.length > 1 && (
          <div className="hero-switcher" aria-label="Chọn phim nổi bật trên banner">
            <div className="hero-thumbs">
              {heroSlides.map((slide, idx) => (
                <button
                  key={slide.movie.id}
                  type="button"
                  className={`hero-thumb ${idx === heroIndex ? 'active' : ''}`}
                  onClick={() => setHeroIndex(idx)}
                  title={slide.movie.title}
                >
                  {slide.movie.poster && <img src={slide.movie.poster} alt={slide.movie.title} />}
                  <span className={`hero-thumb-dot ${slide.tag === 'viet-nam' ? 'vn' : ''}`} />
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="home-rows">
        <section className="home-rooms-section" aria-label="Danh sách phòng đang mở và phòng tạo sẵn">
          <div className="rooms-sec-head">
            <div>
              <h2 className="row-title">Phòng đang mở</h2>
              <p className="rooms-sec-sub">Sảnh chiếu 24/7 và phòng mọi người vừa tạo · có thể khoá PIN</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={refreshRooms}>
              ↻ Làm mới
            </button>
          </div>

          <div className="room-lobby-grid">
            {rooms.map((r) => (
              <div
                key={r.id}
                className={`room-lobby-card ${r.pinned ? 'pinned' : ''} ${r.hasPin ? 'locked' : ''}`}
                onClick={() => enterExistingRoom(r)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    enterExistingRoom(r);
                  }
                }}
              >
                <div className="room-lobby-top">
                  <span className={`room-badge ${r.hasPin ? 'pin' : r.pinned ? 'official' : 'public'}`}>
                    {r.hasPin ? '🔒 Khoá PIN' : r.pinned ? '★ Sảnh 24/7' : '🌐 Công khai'}
                  </span>
                  <span className="room-code-pill">#{r.id}</span>
                </div>

                <h3 className="room-lobby-title" title={r.title}>
                  {r.title}
                </h3>

                <p className="room-lobby-playing" title={r.playingTitle || 'Đang chờ chọn phim'}>
                  {r.playingTitle ? `🎬 ${r.playingTitle}` : '🍿 Đang chờ chọn phim…'}
                </p>

                <div className="room-lobby-foot">
                  <span className="room-members-count">
                    <span className={`live-dot ${r.memberCount > 0 ? 'on' : 'idle'}`} />
                    {r.memberCount} người trong phòng
                  </span>
                  <span className="room-enter-cta">{r.hasPin ? 'Nhập PIN →' : 'Vào ngay →'}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="home-discover" aria-label="Tìm kiếm và lọc phim">
          <div className="discover-head">
            <h2 className="row-title">Khám phá kho phim</h2>
            <form className="discover-search" onSubmit={submitHomeSearch}>
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm tên phim, anime, phim bộ…"
                aria-label="Tìm tên phim"
              />
              <button className="btn btn-primary" type="submit">
                Tìm kiếm
              </button>
              {isBrowsing && (
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setSubmittedQuery('');
                    setSelectedCategory('');
                    setBrowsePage(1);
                  }}
                >
                  Xoá lọc
                </button>
              )}
            </form>
          </div>

          <div className="discover-pills" role="tablist" aria-label="Lọc theo thể loại">
            {MOVIE_CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat.slug && !submittedQuery;
              return (
                <button
                  key={cat.slug || 'all'}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className={`filter-pill ${cat.featured ? 'vn-featured' : ''} ${cat.aiFeatured ? 'ai-featured' : ''} ${isSelected ? 'active' : ''}`}
                  onClick={() => selectHomeCategory(cat.slug)}
                >
                  {cat.featured && (
                    <span className="vn-emblem" aria-hidden="true">
                      <svg viewBox="0 0 24 24" className="vn-star">
                        <path
                          fill="currentColor"
                          d="M12 2.2l2.92 6.08 6.68.92-4.86 4.68 1.18 6.64L12 17.34l-5.92 3.18 1.18-6.64L2.4 9.2l6.68-.92L12 2.2z"
                        />
                      </svg>
                    </span>
                  )}
                  {cat.aiFeatured && (
                    <span className="ai-sparkle" aria-hidden="true">
                      ✦
                    </span>
                  )}
                  <span>{cat.label}</span>
                  {cat.badge && <span className="pill-badge-new">{cat.badge}</span>}
                </button>
              );
            })}
          </div>

          {isBrowsing && (
            <div className="discover-results">
              {browseLoading && <div className="spinner" aria-label="Đang tải" />}
              {!browseLoading && browseData && (
                <>
                  {browseData.items.length === 0 ? (
                    <p className="muted">Không tìm thấy phim phù hợp.</p>
                  ) : (
                    <div className="movie-grid home-grid">
                      {browseData.items.map((m) => (
                        <button
                          key={m.id}
                          className="movie-card"
                          onClick={() => watchMovie(m)}
                          disabled={!!busy}
                        >
                          <div className="poster-wrap">
                            {m.poster && <img src={m.poster} alt="" loading="lazy" />}
                            {m.currentEpisode && <span className="ep-badge">{m.currentEpisode}</span>}
                            <span className="poster-play" aria-hidden="true">
                              {busy === m.id ? '…' : '▶'}
                            </span>
                          </div>
                          <span className="movie-title">{m.title}</span>
                          <span className="muted small">{[m.year, m.quality].filter(Boolean).join(' · ')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {browseData.totalPages > 1 && (
                    <div className="pager">
                      <button
                        className="btn btn-ghost"
                        disabled={browsePage <= 1}
                        onClick={() => setBrowsePage((p) => p - 1)}
                      >
                        ← Trước
                      </button>
                      <span className="muted">
                        Trang {browseData.page}/{browseData.totalPages}
                      </span>
                      <button
                        className="btn btn-ghost"
                        disabled={browsePage >= browseData.totalPages}
                        onClick={() => setBrowsePage((p) => p + 1)}
                      >
                        Sau →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        <section className="hot-section">
          <div className="hot-header">
            <h2 className="row-title">🔥 Phim đang Hot theo thời gian</h2>
            <div className="hot-tabs" role="tablist" aria-label="Bảng xếp hạng theo thời gian">
              {HOT_PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={hotPeriod === p.key}
                  className={`filter-pill hot ${hotPeriod === p.key ? 'active' : ''}`}
                  onClick={() => setHotPeriod(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <PosterRow
            title=""
            items={hotLoading ? [] : hotItems}
            busyId={busy}
            ranked
            onPick={watchMovie}
          />
        </section>

        <PosterRow title="Mới cập nhật trong kho" items={popular} busyId={busy} onPick={watchMovie} />
        <PosterRow title="Đề xuất xem chung" items={more} busyId={busy} onPick={watchMovie} />

        <section className="how">
          <h2 className="row-title">Cách hoạt động</h2>
          <ol className="how-grid">
            <li>
              <span className="how-num">01</span>
              <h3>Tạo phòng</h3>
              <p>Nhập tên, bấm tạo phòng hoặc chọn một bộ phim ở trên.</p>
            </li>
            <li>
              <span className="how-num">02</span>
              <h3>Gửi link mời</h3>
              <p>Chép link phòng gửi cho bạn bè. Không cần đăng ký.</p>
            </li>
            <li>
              <span className="how-num">03</span>
              <h3>Xem &amp; trò chuyện</h3>
              <p>Phim chạy đồng bộ cho cả phòng. Chat, thả emoji ngay trên màn hình.</p>
            </li>
          </ol>
        </section>
      </main>

      {pickedDetail && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setPickedDetail(null)}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label={pickedDetail.title}>
            <header className="modal-head">
              <h2>Chọn tập để mở phòng</h2>
              <button className="btn btn-ghost icon" onClick={() => setPickedDetail(null)} aria-label="Đóng">
                ✕
              </button>
            </header>
            <div className="modal-body">
              <div className="movie-detail">
                {pickedDetail.poster && (
                  <div
                    className="detail-backdrop"
                    style={{ backgroundImage: `url(${pickedDetail.poster})` }}
                    aria-hidden="true"
                  />
                )}
                {pickedDetail.poster && <img src={pickedDetail.poster} alt="" className="detail-poster" />}
                <div className="detail-info">
                  <h3>{pickedDetail.title}</h3>
                  {pickedDetail.year && <p className="muted">{pickedDetail.year}</p>}
                  {pickedDetail.description && <p className="detail-desc">{pickedDetail.description}</p>}
                  <EpisodePicker
                    key={pickedDetail.id}
                    episodes={pickedDetail.episodes}
                    disabled={!!busy}
                    onPick={(ep) =>
                      void createRoom(
                        pickedDetail.id,
                        toVideoSource(
                          ep.url,
                          pickedDetail.episodes.length > 1 ? `${pickedDetail.title} · ${ep.name}` : pickedDetail.title,
                        ),
                        pickedDetail,
                      )
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">
        <Logo />
        <span className="muted small">Đồ án môn học · Video YouTube, kho phim qua API và link video công khai.</span>
      </footer>
      {pinModalRoom && (
        <div className="modal-backdrop" onClick={() => setPinModalRoom(null)}>
          <div className="modal-card pin-modal-card" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <div>
                <p className="kicker">🔒 Phòng Riêng Tư</p>
                <h3 className="pin-modal-title" title={pinModalRoom.title}>
                  {pinModalRoom.title}
                </h3>
                <span className="room-code-pill">#{pinModalRoom.id}</span>
              </div>
              <button className="btn btn-ghost" onClick={() => setPinModalRoom(null)} aria-label="Đóng">
                ✕
              </button>
            </header>
            <form className="pin-modal-form" onSubmit={submitPinJoin}>
              <p className="muted">Phòng này được bảo vệ bằng mã PIN / mật khẩu. Nhập mã PIN để vào phòng:</p>
              <input
                type="password"
                value={joinPinInput}
                onChange={(e) => {
                  setJoinPinInput(e.target.value);
                  setJoinPinError(null);
                }}
                placeholder="Nhập mã PIN / mật khẩu…"
                autoFocus
                maxLength={12}
                aria-label="Nhập mã PIN"
              />
              {joinPinError && <p className="error-text">{joinPinError}</p>}
              <div className="pin-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setPinModalRoom(null)}>
                  Huỷ
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy === 'pin-verify'}>
                  {busy === 'pin-verify' ? 'Đang kiểm tra…' : 'Mở khoá & Vào phòng'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
