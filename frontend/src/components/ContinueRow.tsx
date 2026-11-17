import { useRef } from 'react';
import { percentWatched, type WatchProgress } from '../progress';
import { formatTime } from '../utils';

interface Props {
  items: WatchProgress[];
  onPick(item: WatchProgress): void;
  onRemove(item: WatchProgress): void;
}

/** Hàng "Tiếp tục xem" kiểu Netflix: poster + thanh đỏ thể hiện đã xem bao nhiêu. */
export function ContinueRow({ items, onPick, onRemove }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  if (items.length === 0) return null;

  const scroll = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <section className="row continue-row" aria-label="Tiếp tục xem">
      <h2 className="row-title">Tiếp tục xem</h2>
      <div className="row-wrap">
        <button className="row-arrow left" onClick={() => scroll(-1)} aria-label="Cuộn trái">
          ‹
        </button>
        <div className="row-track" ref={trackRef}>
          {items.map((p) => {
            const epLabel = p.multiEpisode ? p.epName.replace(/\s*\(.*\)\s*$/, '') : '';
            const pct = percentWatched(p);
            return (
              <div key={p.movieId} className="continue-card">
                <button className="poster" onClick={() => onPick(p)} title={`Xem tiếp ${p.title}`}>
                  {p.poster && <img src={p.poster} alt="" loading="lazy" />}
                  <div className="poster-shade always">
                    <span className="poster-play">▶</span>
                    <span className="poster-name">{p.title}</span>
                    <span className="poster-year">
                      {[epLabel, p.position > 0 ? `còn ${formatTime(Math.max(0, p.duration - p.position))}` : 'Tập mới']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <span className="continue-bar" aria-hidden="true">
                    <span style={{ width: `${p.position > 0 ? pct : 0}%` }} />
                  </span>
                </button>
                <button
                  type="button"
                  className="continue-remove"
                  onClick={() => onRemove(p)}
                  aria-label={`Xoá ${p.title} khỏi Tiếp tục xem`}
                  title="Xoá khỏi danh sách"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <button className="row-arrow right" onClick={() => scroll(1)} aria-label="Cuộn phải">
          ›
        </button>
      </div>
    </section>
  );
}
