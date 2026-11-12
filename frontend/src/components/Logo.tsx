import { Link } from 'react-router-dom';

export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <Link to="/" className={`logo logo-${size}`} aria-label="Xem Cùng - Trang chủ">
      <svg viewBox="0 0 24 24" className="logo-mark" aria-hidden="true">
        <rect x="2" y="4" width="20" height="16" rx="3" fill="currentColor" />
        <path d="M10 8.5v7l6-3.5z" fill="#0a0a0b" />
      </svg>
      <span>
        XEM<span className="logo-accent">CÙNG</span>
      </span>
    </Link>
  );
}
