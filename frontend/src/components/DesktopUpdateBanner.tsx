import { useEffect, useState } from 'react';

const RELEASES_API = 'https://api.github.com/repos/truongquangquoc2011/xem-cung/releases/latest';
const MANIFEST_FALLBACK = 'https://xem-cung.vercel.app/desktop-version.json';
const DOWNLOAD_PAGE = 'https://xem-cung.vercel.app/download.html';

interface UpdateInfo {
  version: string;
  url: string;
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

/** Hiển thị thanh báo cập nhật nhẹ ở đầu trang khi chạy trên Desktop App và có bản mới. */
export function DesktopUpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const w = window as unknown as {
      __TAURI__?: { core?: { invoke?: <T>(cmd: string) => Promise<T> } };
      __TAURI_INTERNALS__?: { invoke?: <T>(cmd: string) => Promise<T> };
    };
    const invoke = w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke;
    if (!invoke) return;

    let cancelled = false;
    void (async () => {
      try {
        const currentVersion = await invoke<string>('get_app_version');
        if (!currentVersion || cancelled) return;

        let latestVersion = '';
        let downloadUrl = DOWNLOAD_PAGE;

        try {
          const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
          if (res.ok) {
            const data = (await res.json()) as {
              tag_name?: string;
              html_url?: string;
              assets?: Array<{ name?: string; browser_download_url?: string }>;
            };
            latestVersion = (data.tag_name ?? '').replace(/^v/i, '');
            const setupAsset = data.assets?.find((a) => /setup\.exe$/i.test(a.name ?? ''));
            downloadUrl = setupAsset?.browser_download_url ?? data.html_url ?? DOWNLOAD_PAGE;
          }
        } catch {
          /* fallback sang manifest trên Vercel */
        }

        if (!latestVersion) {
          const res = await fetch(`${MANIFEST_FALLBACK}?t=${Date.now()}`);
          if (res.ok) {
            const data = (await res.json()) as { version?: string; downloadUrl?: string };
            latestVersion = (data.version ?? '').replace(/^v/i, '');
            if (data.downloadUrl) downloadUrl = data.downloadUrl;
          }
        }

        if (!cancelled && latestVersion && compareSemver(latestVersion, currentVersion) > 0) {
          setUpdate({ version: latestVersion, url: downloadUrl });
        }
      } catch {
        /* không làm phiền nếu mất mạng */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || dismissed) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 14px',
        borderRadius: '12px',
        background: 'linear-gradient(135deg, #181826 0%, #24121d 100%)',
        border: '1px solid rgba(229, 9, 20, 0.45)',
        boxShadow: '0 14px 36px rgba(0, 0, 0, 0.65)',
        color: '#fff',
        fontSize: '13px',
        fontWeight: 500,
        maxWidth: 'calc(100vw - 32px)',
        zIndex: 9999,
      }}
    >
      <span>🚀 Có bản mới <strong>v{update.version}</strong></span>
      <a
        href={update.url}
        target="_blank"
        rel="noreferrer"
        style={{
          background: '#e50914',
          color: '#fff',
          padding: '5px 12px',
          borderRadius: '8px',
          fontWeight: 700,
          textDecoration: 'none',
        }}
      >
        Tải bản mới
      </a>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.2)',
          color: '#d1d5db',
          padding: '4px 10px',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '12px',
        }}
      >
        Để sau
      </button>
    </div>
  );
}
