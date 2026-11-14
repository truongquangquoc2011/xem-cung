import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { MovieDetail, MovieSummary, VideoSource } from '../types';
import { toVideoSource } from '../utils';
import { fetchYouTubeTitle, parseYouTubeId } from '../youtube';
import { MovieLibrary } from './MovieLibrary';

type Tab = 'youtube' | 'library' | 'ai' | 'link';

interface Props {
  onLoad(source: VideoSource): void;
  disabled?: boolean;
  rememberedMovie?: MovieDetail | null;
  playingUrl?: string;
  onRememberMovie?(detail: MovieDetail | null): void;
}

/** Thanh chọn nội dung: YouTube (link + tìm kiếm), Kho phim (Nguồn C), Phim AI, hoặc dán link mp4/m3u8. */
export function SourcePicker({
  onLoad,
  disabled,
  rememberedMovie = null,
  playingUrl,
  onRememberMovie,
}: Props) {
  const [tab, setTab] = useState<Tab>('youtube');
  const [ytInput, setYtInput] = useState('');
  const [ytSearchQuery, setYtSearchQuery] = useState('');
  const [ytResults, setYtResults] = useState<MovieSummary[]>([]);
  const [ytLoading, setYtLoading] = useState(false);

  const [aiQuery, setAiQuery] = useState('');
  const [aiResults, setAiResults] = useState<MovieSummary[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadedOnce, setAiLoadedOnce] = useState(false);

  const [link, setLink] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  useEffect(() => {
    if (tab !== 'ai' || aiLoadedOnce) return;
    setAiLoadedOnce(true);
    setAiLoading(true);
    api
      .searchAi('')
      .then((res) => setAiResults(res.items))
      .catch((e: Error) => setError(e.message))
      .finally(() => setAiLoading(false));
  }, [tab, aiLoadedOnce]);

  const submitYouTube = async (e: FormEvent) => {
    e.preventDefault();
    const id = parseYouTubeId(ytInput);
    if (!id) {
      setError('Link YouTube không hợp lệ.');
      return;
    }
    setError(null);
    const title = (await fetchYouTubeTitle(id)) ?? `YouTube · ${id}`;
    onLoad({ type: 'youtube', url: id, title });
    setYtInput('');
  };

  const searchYouTube = async (e: FormEvent) => {
    e.preventDefault();
    const q = ytSearchQuery.trim();
    if (!q) return;
    setError(null);
    setYtLoading(true);
    try {
      const res = await api.searchYouTube(q);
      setYtResults(res.items);
      if (res.items.length === 0) setError('Không tìm thấy video YouTube phù hợp.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setYtLoading(false);
    }
  };

  const searchAi = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setAiLoading(true);
    try {
      const res = await api.searchAi(aiQuery.trim());
      setAiResults(res.items);
      if (res.items.length === 0) setError('Không tìm thấy phim AI phù hợp.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const pickItem = async (item: MovieSummary) => {
    if (disabled) return;
    setError(null);
    if (item.id.startsWith('yt-')) {
      const videoId = item.id.slice(3);
      onLoad({ type: 'youtube', url: videoId, title: item.title });
      return;
    }
    try {
      const detail = await api.movieDetail(item.id);
      if (detail.episodes.length === 0) {
        setError('Phim này chưa có tập phát được.');
        return;
      }
      onRememberMovie?.(detail);
      const ep = detail.episodes[0];
      onLoad(toVideoSource(ep.url, detail.episodes.length > 1 ? `${detail.title} · ${ep.name}` : detail.title));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submitLink = (e: FormEvent) => {
    e.preventDefault();
    const url = link.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError('Link phải bắt đầu bằng http:// hoặc https://');
      return;
    }
    setError(null);
    onLoad({ type: 'video', url, title: linkTitle.trim() || url.split('/').pop() || 'Video' });
    setLink('');
    setLinkTitle('');
  };

  return (
    <section className="source-picker" aria-label="Chọn nội dung">
      <div className="source-head">
        <div className="tabs" role="tablist">
          {(
            [
              ['youtube', 'YouTube'],
              ['library', 'Kho phim'],
              ['ai', '✦ Phim AI'],
              ['link', 'Link video'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`tab ${key === 'ai' ? 'ai-tab' : ''} ${tab === key ? 'active' : ''}`}
              onClick={() => {
                setTab(key);
                setError(null);
              }}
            >
              <span>{label}</span>
              {key === 'ai' && <span className="pill-badge-new">Mới</span>}
            </button>
          ))}
        </div>
        {rememberedMovie && rememberedMovie.episodes.length > 1 && (
          <button
            type="button"
            className="btn btn-secondary small"
            disabled={disabled}
            onClick={() => setLibraryOpen(true)}
          >
            📺 Chọn tập ({rememberedMovie.title})
          </button>
        )}
      </div>

      {tab === 'youtube' && (
        <div className="source-stack">
          <form className="source-row" onSubmit={submitYouTube}>
            <input
              value={ytInput}
              onChange={(e) => setYtInput(e.target.value)}
              placeholder="Dán link YouTube…"
              disabled={disabled}
            />
            <button className="btn btn-primary" disabled={disabled || !ytInput.trim()}>
              Chiếu
            </button>
          </form>

          <form className="source-row" onSubmit={searchYouTube}>
            <input
              value={ytSearchQuery}
              onChange={(e) => setYtSearchQuery(e.target.value)}
              placeholder="Tìm video trên YouTube…"
              disabled={disabled}
            />
            <button className="btn btn-secondary" disabled={disabled || !ytSearchQuery.trim() || ytLoading}>
              {ytLoading ? 'Đang tìm…' : 'Tìm'}
            </button>
          </form>

          {ytResults.length > 0 && (
            <div className="source-results-grid">
              {ytResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="source-yt-card"
                  disabled={disabled}
                  onClick={() => void pickItem(item)}
                >
                  <div className="source-yt-thumb">
                    <img src={item.poster} alt={item.title} loading="lazy" />
                    {item.currentEpisode && <span className="source-yt-dur">{item.currentEpisode}</span>}
                  </div>
                  <div className="source-yt-meta">
                    <strong title={item.title}>{item.title}</strong>
                    <span className="muted">{item.quality || 'YouTube'}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'library' && (
        <div className="source-row">
          <p className="muted grow">Tìm phim trong kho rồi chiếu cho cả phòng.</p>
          <button className="btn btn-primary" disabled={disabled} onClick={() => setLibraryOpen(true)}>
            Mở kho phim
          </button>
        </div>
      )}

      {tab === 'ai' && (
        <div className="source-stack">
          <form className="source-row" onSubmit={searchAi}>
            <input
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              placeholder="Tìm Phim AI (VD: tu tiên…)"
              disabled={disabled}
            />
            <button className="btn btn-primary" disabled={disabled || aiLoading}>
              {aiLoading ? 'Đang tìm…' : 'Tìm'}
            </button>
          </form>

          {aiLoading && <p className="muted">Đang tải danh sách Phim AI…</p>}

          {!aiLoading && aiResults.length > 0 && (
            <div className="source-results-grid">
              {aiResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="source-yt-card"
                  disabled={disabled}
                  onClick={() => void pickItem(item)}
                >
                  <div className="source-yt-thumb">
                    <img src={item.poster} alt={item.title} loading="lazy" />
                    <span className="source-yt-ai-tag">AI</span>
                    {item.currentEpisode && <span className="source-yt-dur">{item.currentEpisode}</span>}
                  </div>
                  <div className="source-yt-meta">
                    <strong title={item.title}>{item.title}</strong>
                    <span className="muted">
                      {item.id.startsWith('yt-') ? `YouTube · ${item.quality || 'Phim AI'}` : 'Kho phim · Phim AI'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'link' && (
        <form className="source-row wrap" onSubmit={submitLink}>
          <input
            className="grow-2"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Link .mp4 hoặc .m3u8"
            disabled={disabled}
          />
          <input
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="Tên hiển thị (tuỳ chọn)"
            disabled={disabled}
          />
          <button className="btn btn-primary" disabled={disabled || !link.trim()}>
            Chiếu
          </button>
        </form>
      )}

      {error && <p className="error-text">{error}</p>}

      {libraryOpen && (
        <MovieLibrary
          initialDetail={rememberedMovie}
          playingUrl={playingUrl}
          onRememberDetail={onRememberMovie}
          onClose={() => setLibraryOpen(false)}
          onPick={(s, movieDetail) => {
            if (movieDetail) onRememberMovie?.(movieDetail);
            onLoad(s);
            setLibraryOpen(false);
          }}
        />
      )}
    </section>
  );
}
