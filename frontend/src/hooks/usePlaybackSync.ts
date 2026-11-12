import { useCallback, useEffect, useRef, useState } from 'react';
import type { ControlAction, PlaybackState, PlayerHandle, VideoSource } from '../types';

/** Lệch quá ngưỡng này (giây) thì coi là người dùng tự tua. */
const USER_SEEK_THRESHOLD = 1.5;
/** Khi đang phát, lệch quá ngưỡng này thì tự tua lại cho khớp phòng. */
const DRIFT_THRESHOLD = 2;
/** Bỏ qua sự kiện của trình phát trong khoảng này sau khi ta tự điều khiển nó. */
const ECHO_WINDOW_MS = 1000;
const CHECK_INTERVAL_MS = 2000;

interface Options {
  state: PlaybackState | null;
  serverNow(): number;
  control(action: ControlAction, position?: number, source?: VideoSource): void;
}

/**
 * Đồng bộ trình phát với trạng thái phòng.
 *
 * - Nhận trạng thái mới từ server -> tua / phát / dừng cho khớp.
 * - Người dùng tự bấm play / pause / tua -> gửi lên server.
 * - Mỗi 2 giây kiểm tra lệch giờ và sửa lại.
 *
 * Chống vòng lặp: sự kiện nào khớp với trạng thái phòng (sai số < 1.5s) thì không gửi lại.
 */
export function usePlaybackSync({ state, serverNow, control }: Options) {
  const handleRef = useRef<PlayerHandle | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const appliedAt = useRef(0);
  const localActionAt = useRef(0);
  const playAttemptAt = useRef(0);
  /**
   * true khi trình phát đã khớp với phòng. Trước đó (đang tải, vừa bị tua theo phòng)
   * mọi sự kiện play/pause/seek đều do máy tự gây ra, không phải người dùng -> bỏ qua.
   * Tránh lỗi: YouTube tải chậm, bắt đầu phát ở 0:00 rồi kéo cả phòng về đầu.
   */
  const synced = useRef(false);
  const [needsGesture, setNeedsGesture] = useState(false);

  const expected = useCallback(
    (s: PlaybackState) => (s.playing ? s.position + Math.max(0, serverNow() - s.updatedAt) / 1000 : s.position),
    [serverNow],
  );

  const apply = useCallback(
    (threshold: number) => {
      const h = handleRef.current;
      const s = stateRef.current;
      if (!h || !s?.source) return;
      const target = expected(s);
      let acted = false;
      if (Math.abs(h.getTime() - target) > threshold) {
        h.seek(target);
        synced.current = false;
        acted = true;
      }
      if (s.playing && !h.isPlaying()) {
        h.play();
        playAttemptAt.current = Date.now();
        acted = true;
      } else if (!s.playing && h.isPlaying()) {
        h.pause();
        acted = true;
      }
      if (acted) appliedAt.current = Date.now();
    },
    [expected],
  );

  // Trạng thái phòng thay đổi -> áp dụng ngay
  useEffect(() => {
    apply(0.75);
    if (!state?.playing) setNeedsGesture(false);
  }, [state, apply]);

  // Kiểm tra định kỳ
  useEffect(() => {
    const timer = setInterval(() => {
      const h = handleRef.current;
      const s = stateRef.current;
      if (!h || !s?.source) return;
      if (Date.now() - Math.max(appliedAt.current, localActionAt.current) < 1500) return;

      if (!synced.current) {
        if (isInSync(h, s)) synced.current = true;
        else apply(0.75);
        return;
      }

      if (!s.playing && !h.isPlaying()) {
        // Phòng đang dừng mà vị trí lệch nhiều -> người dùng đã tua khi đang dừng
        // (YouTube không báo sự kiện tua lúc dừng nên phải dò bằng cách này)
        const t = h.getTime();
        if (Math.abs(t - s.position) > 3) {
          localActionAt.current = Date.now();
          control('seek', t);
        }
        return;
      }
      if (s.playing && !h.isPlaying() && playAttemptAt.current && Date.now() - playAttemptAt.current > 1500) {
        setNeedsGesture(true); // trình duyệt chặn tự phát
      }
      apply(DRIFT_THRESHOLD);
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [apply, control]);

  const isInSync = useCallback(
    (h: PlayerHandle, s: PlaybackState) =>
      Math.abs(h.getTime() - expected(s)) < USER_SEEK_THRESHOLD && h.isPlaying() === s.playing,
    [expected],
  );

  /** Sự kiện do máy tự gây ra (không phải người dùng)? Nếu chưa khớp thì kéo về trạng thái phòng. */
  const isEcho = () => {
    if (Date.now() - appliedAt.current < ECHO_WINDOW_MS) return true;
    const h = handleRef.current;
    const s = stateRef.current;
    if (!synced.current && h && s) {
      if (isInSync(h, s)) synced.current = true;
      else apply(0.75);
      return true;
    }
    return false;
  };

  const onReady = useCallback(
    (h: PlayerHandle) => {
      handleRef.current = h;
      synced.current = false;
      apply(0.5);
    },
    [apply],
  );

  const onPlay = useCallback(
    (t: number) => {
      setNeedsGesture(false);
      const s = stateRef.current;
      if (!s?.source || isEcho()) return;
      if (s.playing && Math.abs(t - expected(s)) < USER_SEEK_THRESHOLD) return;
      localActionAt.current = Date.now();
      control('play', t);
    },
    [control, expected],
  );

  const onPause = useCallback(
    (t: number) => {
      const s = stateRef.current;
      if (!s?.source || isEcho()) return;
      if (!s.playing && Math.abs(t - s.position) < USER_SEEK_THRESHOLD) return;
      localActionAt.current = Date.now();
      control('pause', t);
    },
    [control],
  );

  const onSeek = useCallback(
    (t: number) => {
      const s = stateRef.current;
      if (!s?.source || isEcho()) return;
      if (Math.abs(t - expected(s)) < USER_SEEK_THRESHOLD) return;
      localActionAt.current = Date.now();
      control('seek', t);
    },
    [control, expected],
  );

  /** Gọi khi đổi nguồn video (trình phát cũ bị huỷ). */
  const resetPlayer = useCallback(() => {
    handleRef.current = null;
    synced.current = false;
    playAttemptAt.current = 0;
    setNeedsGesture(false);
  }, []);

  /** Người dùng bấm nút "Bấm để xem" (cho phép trình duyệt phát). */
  const resumeWithGesture = useCallback(() => {
    setNeedsGesture(false);
    const h = handleRef.current;
    const s = stateRef.current;
    if (!h || !s) return;
    h.seek(expected(s));
    h.play();
    appliedAt.current = Date.now();
  }, [expected]);

  return {
    needsGesture,
    onBlocked: () => setNeedsGesture(true),
    playerCallbacks: { onReady, onPlay, onPause, onSeek },
    resetPlayer,
    resumeWithGesture,
  };
}
