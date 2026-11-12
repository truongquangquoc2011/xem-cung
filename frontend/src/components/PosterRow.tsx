import { useRef } from 'react';
import type { MovieSummary } from '../types';

interface Props {
  title: string;
  items: MovieSummary[];
  busyId?: string | null;
  onPick(movie: MovieSummary): void;
}

/** Hàng poster cuộn ngang, có nút mũi tên trái/phải. */
export function PosterRow({ title, items, busyId, onPick }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  if (items.length === 0) {
    return (
      <section className="row">
        <h2 className="row-title">{title}</h2>
        <div className="row-track">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="poster skeleton" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="row">
      <h2 className="row-title">{title}</h2>
      <div className="row-wrap">
        <button className="row-arrow left" onClick={() => scroll(-1)} aria-label="Cuộn trái">
          ‹
        </button>
        <div className="row-track" ref={trackRef}>
          {items.map((m) => (
            <button key={m.id} className="poster" onClick={() => onPick(m)} disabled={!!busyId} title={m.title}>
              {m.poster && <img src={m.poster} alt="" loading="lazy" />}
              <div className="poster-shade">
                <span className="poster-play">{busyId === m.id ? '…' : '▶'}</span>
                <span className="poster-name">{m.title}</span>
                {m.year && <span className="poster-year">{m.year}</span>}
              </div>
            </button>
          ))}
        </div>
        <button className="row-arrow right" onClick={() => scroll(1)} aria-label="Cuộn phải">
          ›
        </button>
      </div>
    </section>
  );
}
