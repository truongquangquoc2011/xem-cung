import { useMemo, useState } from 'react';
import { filterEpisodes, groupEpisodes, groupOfUrl } from '../episodes';
import type { Episode } from '../types';

interface Props {
  episodes: Episode[];
  /** URL tập đang chiếu (để đánh dấu & mở đúng bản). */
  playingUrl?: string;
  disabled?: boolean;
  onPick(ep: Episode): void;
}

/**
 * Chọn tập thông minh: tách theo bản (Vietsub / Thuyết minh / Lồng tiếng...),
 * sắp đúng thứ tự, lọc nhanh kiểu "5", "10-20", "cuối".
 */
export function EpisodePicker({ episodes, playingUrl, disabled, onPick }: Props) {
  const groups = useMemo(() => groupEpisodes(episodes), [episodes]);
  const [activeKey, setActiveKey] = useState(() => groupOfUrl(groups, playingUrl)?.key ?? '');
  const [query, setQuery] = useState('');

  const active = groups.find((g) => g.key === activeKey) ?? groups[0];
  const shown = useMemo(() => (active ? filterEpisodes(active.episodes, query) : []), [active, query]);

  if (episodes.length === 0) {
    return <p className="muted">Phim này không có bản phát được trên web.</p>;
  }

  // Phim lẻ 1 tập: chỉ cần 1 nút chiếu
  if (episodes.length === 1) {
    const ep = episodes[0];
    return (
      <button
        className={`btn ${playingUrl === ep.url ? 'btn-secondary' : 'btn-primary'} ep-single`}
        disabled={disabled}
        onClick={() => onPick(ep)}
      >
        ▶ {playingUrl === ep.url ? 'Đang chiếu' : 'Chiếu cho cả phòng'}
      </button>
    );
  }

  const total = active?.episodes.length ?? 0;

  return (
    <div className="ep-picker">
      {groups.length > 1 && (
        <div className="ep-versions" role="tablist" aria-label="Chọn bản phim">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={g.key === active?.key}
              className={`ep-version ${g.kind} ${g.key === active?.key ? 'active' : ''}`}
              onClick={() => {
                setActiveKey(g.key);
                setQuery('');
              }}
            >
              {g.label}
              <span className="ep-version-count">{g.episodes.length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="ep-head-row">
        <h4>
          {active?.label && groups.length > 1 ? `${active.label} · ` : ''}
          {total} tập
        </h4>
        {total > 8 && (
          <input
            className="ep-filter-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tập số, 10-20, cuối…"
            aria-label="Lọc nhanh tập phim"
          />
        )}
      </div>

      {shown.length === 0 ? (
        <p className="muted small">Không có tập khớp “{query}”.</p>
      ) : (
        <div className="episode-list">
          {shown.map((p) => {
            const isPlaying = playingUrl === p.ep.url;
            return (
              <button
                key={`${p.versionKey}-${p.index}`}
                className={`btn ${isPlaying ? 'btn-primary' : 'btn-secondary'} ep-btn`}
                disabled={disabled}
                title={p.ep.name}
                onClick={() => onPick(p.ep)}
              >
                {isPlaying ? '▶ ' : ''}
                {p.shortLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
