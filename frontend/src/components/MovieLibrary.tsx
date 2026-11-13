import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { HOT_PERIODS, MOVIE_CATEGORIES, type HotPeriod } from '../constants/movies';
import type { MovieDetail, MoviePage, VideoSource } from '../types';
import { toVideoSource } from '../utils';

interface Props {
  onPick(source: VideoSource, movieDetail?: MovieDetail): void;
  onClose(): void;
  initialDetail?: MovieDetail | null;
  playingUrl?: string;
  onRememberDetail?(detail: MovieDetail | null): void;
}

/** Kho phim lấy từ backend (/api/movies), hỗ trợ tìm kiếm, lọc thể loại, phim hot và nhớ tập đang xem. */
export function MovieLibrary({
  onPick,
  onClose,
  initialDetail = null,
  playingUrl,
  onRememberDetail,
}: Props) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [category, setCategory] = useState('');
  const [period, setPeriod] = useState<HotPeriod | ''>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MoviePage | null>(null);
  const [detail, setDetail] = useState<MovieDetail | null>(initialDetail);
  const [episodeFilter, setEpisodeFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .searchMovies(submitted, page, category, period)
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [submitted, page, category, period]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openDetail = (id: string) => {
    setLoading(true);
    setError(null);
    setEpisodeFilter('');
    api
      .movieDetail(id)
      .then((d) => {
        setDetail(d);
        onRememberDetail?.(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    setDetail(null);
    setPage(1);
    setSubmitted(query.trim());
    if (query.trim()) {
      setCategory('');
      setPeriod('');
    }
  };

  const selectCategory = (slug: string) => {
    setDetail(null);
    setSubmitted('');
    setQuery('');
    setPeriod('');
    setPage(1);
    setCategory(slug);
  };

  const selectPeriod = (next: HotPeriod) => {
    setDetail(null);
    setSubmitted('');
    setQuery('');
    setCategory('');
    setPage(1);
    setPeriod((cur) => (cur === next ? '' : next));
  };

  const filteredEpisodes = detail
    ? detail.episodes.filter((ep) =>
        episodeFilter.trim()
          ? ep.name.toLowerCase().includes(episodeFilter.trim().toLowerCase())
          : true,
      )
    : [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Kho phim">
        <header className="modal-head">
          {detail ? (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setDetail(null);
                setEpisodeFilter('');
              }}
            >
              ← Danh sách
            </button>
          ) : (
            <h2>Kho phim</h2>
          )}
          <button className="btn btn-ghost icon" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </header>

        {!detail && (
          <div className="library-controls">
            <form className="search-row" onSubmit={search}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên phim…" autoFocus />
              <button className="btn btn-primary">Tìm</button>
            </form>

            <div className="filter-pills" role="tablist" aria-label="Thể loại phim">
              {MOVIE_CATEGORIES.map((cat) => {
                const isSelected = category === cat.slug && !period && !submitted;
                return (
                  <button
                    key={cat.slug || 'all'}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`filter-pill ${cat.featured ? 'vn-featured' : ''} ${cat.aiFeatured ? 'ai-featured' : ''} ${isSelected ? 'active' : ''}`}
                    onClick={() => selectCategory(cat.slug)}
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

            <div className="hot-pills" aria-label="Phim hot theo thời gian">
              <span className="hot-label">🔥 Xếp hạng:</span>
              {HOT_PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`filter-pill hot ${period === p.key ? 'active' : ''}`}
                  onClick={() => selectPeriod(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="modal-body">
          {error && <p className="error-text">{error}</p>}
          {loading && <div className="spinner" aria-label="Đang tải" />}

          {!loading && detail && (
            <div className="movie-detail">
              {detail.poster && (
                <div className="detail-backdrop" style={{ backgroundImage: `url(${detail.poster})` }} aria-hidden="true" />
              )}
              {detail.poster && <img src={detail.poster} alt="" className="detail-poster" />}
              <div className="detail-info">
                <h3>{detail.title}</h3>
                {detail.year && <p className="muted">{detail.year}</p>}
                {detail.description && <p className="detail-desc">{detail.description}</p>}
                <div className="ep-head-row">
                  <h4>{detail.episodes.length > 1 ? `Chọn tập (${detail.episodes.length} tập)` : 'Phát'}</h4>
                  {detail.episodes.length > 8 && (
                    <input
                      className="ep-filter-input"
                      value={episodeFilter}
                      onChange={(e) => setEpisodeFilter(e.target.value)}
                      placeholder="Lọc số tập…"
                      aria-label="Lọc nhanh số tập"
                    />
                  )}
                </div>
                {detail.episodes.length === 0 && <p className="muted">Phim này không có bản phát được trên web.</p>}
                <div className="episode-list">
                  {filteredEpisodes.map((ep) => {
                    const isPlaying = playingUrl === ep.url;
                    return (
                      <button
                        key={`${ep.name}-${ep.url}`}
                        className={`btn ${isPlaying ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => {
                          onRememberDetail?.(detail);
                          onPick(
                            toVideoSource(
                              ep.url,
                              detail.episodes.length > 1 ? `${detail.title} · ${ep.name}` : detail.title,
                            ),
                            detail,
                          );
                        }}
                      >
                        {isPlaying ? '▶ ' : ''}
                        {detail.episodes.length > 1 ? ep.name : 'Chiếu cho cả phòng'}
                        {isPlaying ? ' (Đang chiếu)' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {!loading && !detail && data && (
            <>
              {data.items.length === 0 && <p className="muted">Không tìm thấy phim nào.</p>}
              <div className="movie-grid">
                {data.items.map((m, idx) => (
                  <button key={m.id} className="movie-card" onClick={() => openDetail(m.id)}>
                    <div className="poster-wrap">
                      {m.poster && <img src={m.poster} alt="" loading="lazy" />}
                      {period && <span className={`rank-badge ${idx < 3 ? 'top' : ''}`}>#{(page - 1) * 20 + idx + 1}</span>}
                      {m.currentEpisode && <span className="ep-badge">{m.currentEpisode}</span>}
                      <span className="poster-play" aria-hidden="true">
                        ▶
                      </span>
                    </div>
                    <span className="movie-title">{m.title}</span>
                    <span className="muted small">{[m.year, m.quality].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
              {data.totalPages > 1 && (
                <div className="pager">
                  <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    ← Trước
                  </button>
                  <span className="muted">
                    Trang {data.page}/{data.totalPages}
                  </span>
                  <button
                    className="btn btn-ghost"
                    disabled={page >= data.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Sau →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
