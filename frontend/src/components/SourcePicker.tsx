import { useState, type FormEvent } from 'react';
import type { VideoSource } from '../types';
import { fetchYouTubeTitle, parseYouTubeId } from '../youtube';
import { MovieLibrary } from './MovieLibrary';

type Tab = 'youtube' | 'library' | 'link';

interface Props {
  onLoad(source: VideoSource): void;
  disabled?: boolean;
}

/** Thanh chọn nội dung: YouTube, Kho phim, hoặc dán link mp4/m3u8. */
export function SourcePicker({ onLoad, disabled }: Props) {
  const [tab, setTab] = useState<Tab>('youtube');
  const [ytInput, setYtInput] = useState('');
  const [link, setLink] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

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
      <div className="tabs" role="tablist">
        {(
          [
            ['youtube', 'YouTube'],
            ['library', 'Kho phim'],
            ['link', 'Link video'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`tab ${tab === key ? 'active' : ''}`}
            onClick={() => {
              setTab(key);
              setError(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'youtube' && (
        <form className="source-row" onSubmit={submitYouTube}>
          <input
            value={ytInput}
            onChange={(e) => setYtInput(e.target.value)}
            placeholder="Dán link YouTube, ví dụ https://youtu.be/…"
            disabled={disabled}
          />
          <button className="btn btn-primary" disabled={disabled || !ytInput.trim()}>
            Chiếu
          </button>
        </form>
      )}

      {tab === 'library' && (
        <div className="source-row">
          <p className="muted grow">Tìm phim trong kho rồi chiếu cho cả phòng.</p>
          <button className="btn btn-primary" disabled={disabled} onClick={() => setLibraryOpen(true)}>
            Mở kho phim
          </button>
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
          onClose={() => setLibraryOpen(false)}
          onPick={(s) => {
            onLoad(s);
            setLibraryOpen(false);
          }}
        />
      )}
    </section>
  );
}
