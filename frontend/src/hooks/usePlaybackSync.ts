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
  const lastSeekAt = useRef(0);
  /**
   * true khi trình phát đã khớp với phòng. Trước đó (đang tải, vừa bị tua theo phòng)
   * mọi sự kiện play/pause/seek đều do máy tự gây ra, không phải người dùng -> bỏ qua.
   * Tránh lỗi: YouTube tải chậm, bắt đầu phát ở 0:00 rồi kéo cả phòng về đầu.
   */
  const synced = useRef(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const needsGestureRef = useRef(false);
  const updateNeedsGesture = useCallback((val: boolean) => {
    needsGestureRef.current = val;
    setNeedsGesture(val);
  }, []);

  const expected = useCallback(
    (s: PlaybackState) => (s.playing ? s.position + Math.max(0, serverNow() - s.updatedAt) / 1000 : s.position),
    [serverNow],
  );

  const apply = useCallback(
    (threshold: number) => {
      const h = handleRef.current;
      const s = stateRef.current;
      if (!h || !s?.source) return;
      if (needsGestureRef.current && s.playing) return;
      const target = expected(s);
      const now = Date.now();
      let acted = false;

      // Khi trình phát đang tạm dừng hoặc đang tải phân đoạn đầu tiên (!h.isPlaying()),
      // nếu vừa mới seek gần đây thì KHÔNG seek lại liên tục làm huỷ (ERR_ABORTED) request tải segment HLS.
      const isCurrentlyPlaying = h.isPlaying();
      const shouldSkipSeekBecauseBuffering = !isCurrentlyPlaying && lastSeekAt.current > 0 && now - lastSeekAt.current < 30000;

      if (!shouldSkipSeekBecauseBuffering && Math.abs(h.getTime() - target) > threshold) {
        h.seek(target);
        lastSeekAt.current = now;
        synced.current = false;
        acted = true;
      }
      if (s.playing && !isCurrentlyPlaying) {
        h.play();
        playAttemptAt.current = now;
        acted = true;
      } else if (!s.playing && isCurrentlyPlaying) {
        h.pause();
        acted = true;
      }
      if (acted) appliedAt.current = now;
    },
    [expected],
  );

  // Trạng thái phòng thay đổi -> áp dụng ngay
  useEffect(() => {
    if (!state?.playing) updateNeedsGesture(false);
    lastSeekAt.current = 0;
    apply(0.75);
  }, [state, apply, updateNeedsGesture]);

  // Kiểm tra định kỳ
  useEffect(() => {
    const timer = setInterval(() => {
      const h = handleRef.current;
      const s = stateRef.current;
      if (!h || !s?.source) return;
      if (Date.now() - Math.max(appliedAt.current, localActionAt.current) < 1500) return;
      // Đang tua dở (HLS chờ tải đoạn mới) -> đừng kéo về, nếu không người dùng sẽ không tua được
      if (h.isSeeking?.()) return;

      // Nếu đang chờ người dùng bấm phát (do trình duyệt chặn autoplay), tuyệt đối không tự seek/play lặp lại
      if (needsGestureRef.current) {
        if (!s.playing || h.isPlaying()) {
          updateNeedsGesture(false);
        }
        return;
      }

      if (s.playing && !h.isPlaying()) {
        if (playAttemptAt.current && Date.now() - playAttemptAt.current > 1500) {
          updateNeedsGesture(true); // trình duyệt chặn tự phát
        }
        return;
      }

      if (!synced.current) {
        if (isInSync(h, s)) synced.current = true;
        else apply(3);
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
      apply(DRIFT_THRESHOLD);
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [apply, control, updateNeedsGesture]);

  const isInSync = useCallback(
    (h: PlayerHandle, s: PlaybackState) =>
      Math.abs(h.getTime() - expected(s)) < 3 && h.isPlaying() === s.playing,
    [expected],
  );

  /** Sự kiện do máy tự gây ra (không phải người dùng)? Nếu chưa khớp thì kéo về trạng thái phòng. */
  const isEcho = () => {
    if (Date.now() - appliedAt.current < ECHO_WINDOW_MS) return true;
    const h = handleRef.current;
    const s = stateRef.current;
    if (!synced.current && h && s) {
      if (isInSync(h, s)) {
        synced.current = true;
        return false;
      }
      if (s.playing && h.isPlaying()) {
        const target = expected(s);
        if (Math.abs(h.getTime() - target) > 4) {
          h.seek(target);
          lastSeekAt.current = Date.now();
          appliedAt.current = Date.now();
        }
        synced.current = true;
        return true;
      }
      if (!s.playing && !h.isPlaying()) {
        return true;
      }
      if (!needsGestureRef.current) {
        apply(3);
      }
      return true;
    }
    return false;
  };

  const onReady = useCallback(
    (h: PlayerHandle) => {
      handleRef.current = h;
      synced.current = false;
      lastSeekAt.current = 0;
      apply(0.5);
    },
    [apply],
  );

  const onPlay = useCallback(
    (t: number) => {
      updateNeedsGesture(false);
      const h = handleRef.current;
      const s = stateRef.current;
      if (!s?.source) return;
      if (!synced.current && h && s.playing) {
        const target = expected(s);
        if (Math.abs(t - target) > 4) {
          h.seek(target);
          lastSeekAt.current = Date.now();
          appliedAt.current = Date.now();
        }
        synced.current = true;
        return;
      }
      if (isEcho()) return;
      if (s.playing && Math.abs(t - expected(s)) < 3) return;
      localActionAt.current = Date.now();
      control('play', t);
    },
    [control, expected, updateNeedsGesture],
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
    (t: number, byUser?: boolean) => {
      const s = stateRef.current;
      if (!s?.source) return;
      if (byUser) {
        // Trình phát đã xác nhận đây là người dùng kéo thanh tua -> gửi luôn, không lọc "echo"
        if (Math.abs(t - expected(s)) < USER_SEEK_THRESHOLD) return;
        synced.current = true;
        localActionAt.current = Date.now();
        control('seek', t);
        return;
      }
      if (Date.now() - appliedAt.current < 1500) return;
      if (!synced.current) {
        if (Math.abs(t - expected(s)) < 4) synced.current = true;
        return;
      }
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
    lastSeekAt.current = 0;
    updateNeedsGesture(false);
  }, [updateNeedsGesture]);

  /** Người dùng bấm nút "Bấm để xem" (cho phép trình duyệt phát). */
  const resumeWithGesture = useCallback(() => {
    updateNeedsGesture(false);
    const h = handleRef.current;
    const s = stateRef.current;
    if (!h || !s) return;
    const target = expected(s);
    if (Math.abs(h.getTime() - target) > DRIFT_THRESHOLD) {
      h.seek(target);
      lastSeekAt.current = Date.now();
    }
    h.play();
    playAttemptAt.current = Date.now();
    appliedAt.current = Date.now();
  }, [expected, updateNeedsGesture]);

  return {
    needsGesture,
    onBlocked: () => updateNeedsGesture(true),
    playerCallbacks: { onReady, onPlay, onPause, onSeek },
    resetPlayer,
    resumeWithGesture,
  };
}
