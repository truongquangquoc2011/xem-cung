import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { MovieDetail, MoviePage, VideoSource } from '../types';

interface Props {
  onPick(source: VideoSource): void;
  onClose(): void;
}

/** Kho phim lấy từ backend (/api/movies), nguồn phim cấu hình ở application.yml. */
export function MovieLibrary({ onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MoviePage | null>(null);
  const [detail, setDetail] = useState<MovieDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .searchMovies(submitted, page)
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [submitted, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openDetail = (id: string) => {
    setLoading(true);
    setError(null);
    api
      .movieDetail(id)
      .then(setDetail)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    setDetail(null);
    setPage(1);
    setSubmitted(query.trim());
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Kho phim">
        <header className="modal-head">
          {detail ? (
            <button className="btn btn-ghost" onClick={() => setDetail(null)}>
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
          <form className="search-row" onSubmit={search}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên phim…" autoFocus />
            <button className="btn btn-primary">Tìm</button>
          </form>
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
                <h4>{detail.episodes.length > 1 ? 'Chọn tập' : 'Phát'}</h4>
                {detail.episodes.length === 0 && <p className="muted">Phim này không có bản phát được trên web.</p>}
                <div className="episode-list">
                  {detail.episodes.map((ep) => (
                    <button
                      key={ep.url}
                      className="btn btn-secondary"
                      onClick={() =>
                        onPick({
                          type: 'video',
                          url: ep.url,
                          title: detail.episodes.length > 1 ? `${detail.title} · ${ep.name}` : detail.title,
                        })
                      }
                    >
                      ▶ {detail.episodes.length > 1 ? ep.name : 'Chiếu cho cả phòng'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!loading && !detail && data && (
            <>
              {data.items.length === 0 && <p className="muted">Không tìm thấy phim nào.</p>}
              <div className="movie-grid">
                {data.items.map((m) => (
                  <button key={m.id} className="movie-card" onClick={() => openDetail(m.id)}>
                    <div className="poster-wrap">
                      {m.poster && <img src={m.poster} alt="" loading="lazy" />}
                      <span className="poster-play" aria-hidden="true">
                        ▶
                      </span>
                    </div>
                    <span className="movie-title">{m.title}</span>
                    {m.year && <span className="muted small">{m.year}</span>}
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
