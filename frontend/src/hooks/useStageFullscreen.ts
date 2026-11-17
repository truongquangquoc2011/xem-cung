import { useCallback, useEffect, useRef, useState } from 'react';

function lockLandscape() {
  const isMobile = window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth <= 900;
  if (!isMobile) return;
  try {
    void (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })
      ?.lock?.('landscape')
      ?.catch(() => undefined);
  } catch {
    /* iOS Safari không hỗ trợ orientation.lock */
  }
}

function unlockLandscape() {
  try {
    (screen.orientation as unknown as { unlock?: () => void })?.unlock?.();
  } catch {
    /* ignore */
  }
}

/**
 * Toàn màn hình cho khung phát: dùng Fullscreen API, trình duyệt không cho (iOS) thì
 * "giả toàn màn hình" bằng CSS (.stage.pseudo-fullscreen). Điện thoại tự xoay ngang.
 */
export function useStageFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pseudo, setPseudo] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const active = Boolean(document.fullscreenElement) || pseudo;
      setIsFullscreen(active);
      if (!active) unlockLandscape();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [pseudo]);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      unlockLandscape();
      setIsFullscreen(false);
      return;
    }
    if (pseudo) {
      unlockLandscape();
      setPseudo(false);
      setIsFullscreen(false);
      return;
    }
    const el = ref.current;
    const fallback = () => {
      setPseudo(true);
      setIsFullscreen(true);
      lockLandscape();
    };
    if (el?.requestFullscreen) {
      el.requestFullscreen()
        .then(() => {
          setIsFullscreen(true);
          lockLandscape();
        })
        .catch(fallback);
    } else {
      fallback();
    }
  }, [pseudo]);

  return { ref, isFullscreen, pseudo, toggle };
}
