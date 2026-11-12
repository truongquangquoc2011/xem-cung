import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../components/Logo';
import { PosterRow } from '../components/PosterRow';
import type { MovieSummary, VideoSource } from '../types';
import { loadName, saveName } from '../utils';

export function HomePage() {
  const navigate = useNavigate();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popular, setPopular] = useState<MovieSummary[]>([]);
  const [more, setMore] = useState<MovieSummary[]>([]);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    api.searchMovies('', 1).then((p) => setPopular(p.items)).catch(() => {});
    api.searchMovies('', 2).then((p) => setMore(p.items)).catch(() => {});
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const featured = popular[0];

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

  const createRoom = async (busyKey: string, initialSource?: VideoSource) => {
    const n = requireName();
    if (!n) return;
    setBusy(busyKey);
    setError(null);
    try {
      const { id } = await api.createRoom();
      navigate(`/room/${id}`, { state: { name: n, initialSource } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  /** Chọn phim -> tạo phòng và chiếu luôn tập đầu. */
  const watchMovie = async (m: MovieSummary) => {
    if (!requireName()) return;
    setBusy(m.id);
    setError(null);
    try {
      const d = await api.movieDetail(m.id);
      const ep = d.episodes[0];
      if (!ep) throw new Error('Phim này chưa có bản phát được.');
      const title = d.episodes.length > 1 ? `${d.title} · ${ep.name}` : d.title;
      await createRoom(m.id, { type: 'video', url: ep.url, title });
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
      await api.getRoom(id);
      navigate(`/room/${id}`, { state: { name: n } });
    } catch {
      setError(`Không tìm thấy phòng ${id}.`);
      setBusy(null);
    }
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

      <header className="hero">
        <div
          className="hero-backdrop"
          style={featured?.poster ? { backgroundImage: `url(${featured.poster})` } : undefined}
          aria-hidden="true"
        />
        <div className="hero-shade" aria-hidden="true" />

        <div className="hero-content">
          <p className="kicker">
            <span className="live-dot" /> Phòng chiếu online
          </p>
          <h1 className="hero-title">
            Xem phim cùng nhau,
            <br />
            <em>dù ở xa.</em>
          </h1>
          <p className="hero-lead">
            Tạo phòng, gửi link cho bạn bè. Ai bấm dừng hay tua, cả phòng cùng theo. Vừa xem vừa trò chuyện như ngồi
            chung một rạp.
          </p>

          <div className="hero-form">
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="Tên của bạn"
              maxLength={30}
              aria-label="Tên của bạn"
            />
            <button className="btn btn-primary btn-lg" onClick={() => createRoom('create')} disabled={!!busy}>
              <span aria-hidden="true">▶</span> {busy === 'create' ? 'Đang tạo…' : 'Tạo phòng chiếu'}
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}

          {featured && (
            <button className="featured-chip" onClick={() => watchMovie(featured)} disabled={!!busy}>
              <span className="chip-label">Nổi bật</span>
              <span className="chip-title">{featured.title}</span>
              <span className="chip-cta">{busy === featured.id ? 'Đang mở…' : 'Xem cùng bạn bè →'}</span>
            </button>
          )}
        </div>
      </header>

      <main className="home-rows">
        <PosterRow title="Phổ biến trong kho phim" items={popular} busyId={busy} onPick={watchMovie} />
        <PosterRow title="Phim kinh điển" items={more} busyId={busy} onPick={watchMovie} />

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

      <footer className="footer">
        <Logo />
        <span className="muted small">Đồ án môn học · Video YouTube, kho phim qua API và link video công khai.</span>
      </footer>
    </div>
  );
}
