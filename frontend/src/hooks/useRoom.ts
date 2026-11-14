import { useCallback, useEffect, useRef, useState } from 'react';
import { Client } from '@stomp/stompjs';
import { measureClockOffset, wsUrl } from '../api';
import type {
  ChatMessage,
  ControlAction,
  Member,
  PlaybackState,
  RoomEvent,
  RoomSnapshot,
  VideoSource,
  VoiceSignalPayload,
} from '../types';
import { formatTime } from '../utils';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

const MAX_CHAT = 200;

/** Mô tả ngắn hành động vừa xảy ra, để hiện "Lan vừa tạm dừng ở 12:03". */
function describeChange(prev: PlaybackState | null, next: PlaybackState, by?: string): string | null {
  if (!by) return null;
  if (!prev || prev.source?.url !== next.source?.url) return `${by} đã chọn video mới`;
  if (prev.playing !== next.playing) {
    return next.playing ? `${by} đã tiếp tục phát` : `${by} đã tạm dừng ở ${formatTime(next.position)}`;
  }
  return `${by} đã tua đến ${formatTime(next.position)}`;
}

/**
 * Kết nối STOMP tới phòng: nhận trạng thái phát, chat, danh sách thành viên.
 * name = null thì chưa kết nối (đang chờ người dùng nhập tên).
 */
export function useRoom(roomId: string, name: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<PlaybackState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);

  const clientRef = useRef<Client | null>(null);
  const offsetRef = useRef(0);
  const stateRef = useRef<PlaybackState | null>(null);
  const voiceListenerRef = useRef<((sig: VoiceSignalPayload) => void) | null>(null);

  useEffect(() => {
    if (!name) return;
    let ready = false;

    measureClockOffset()
      .then((o) => (offsetRef.current = o))
      .catch(() => {
        /* dùng đồng hồ máy */
      });

    const client = new Client({ brokerURL: wsUrl(), reconnectDelay: 2000 });

    client.onConnect = () => {
      ready = false;
      setStatus('connected');

      client.subscribe('/user/queue/snapshot', (frame) => {
        const snap: RoomSnapshot = JSON.parse(frame.body);
        ready = true;
        stateRef.current = snap.state;
        setMe(snap.you);
        setState(snap.state);
        setChat(snap.chat);
        setMembers(snap.members);
      });

      client.subscribe('/user/queue/errors', (frame) => {
        setError(JSON.parse(frame.body).message ?? 'Có lỗi xảy ra');
      });

      client.subscribe(`/topic/room/${roomId}`, (frame) => {
        if (!ready) return; // sự kiện trước snapshot đã nằm sẵn trong snapshot
        const event: RoomEvent = JSON.parse(frame.body);
        if (event.type === 'CHAT' && event.message) {
          const msg = event.message;
          setChat((c) => [...c, msg].slice(-MAX_CHAT));
        } else if (event.type === 'MEMBERS' && event.members) {
          setMembers(event.members);
        } else if (event.type === 'STATE' && event.state) {
          const text = describeChange(stateRef.current, event.state, event.by);
          stateRef.current = event.state;
          setState(event.state);
          if (text) setNotice({ text, at: Date.now() });
        } else if (event.type === 'VOICE' && event.voice) {
          voiceListenerRef.current?.(event.voice);
        }
      });

      client.publish({ destination: `/app/room/${roomId}/join`, body: JSON.stringify({ name }) });
    };

    client.onWebSocketClose = () => setStatus('reconnecting');
    client.onStompError = (frame) => setError(frame.headers.message ?? 'Lỗi kết nối');

    client.activate();
    clientRef.current = client;
    return () => {
      clientRef.current = null;
      void client.deactivate();
    };
  }, [roomId, name]);

  const send = useCallback(
    (path: 'control' | 'chat' | 'voice/state' | 'voice/signal', body: unknown) => {
      const c = clientRef.current;
      if (c?.connected) c.publish({ destination: `/app/room/${roomId}/${path}`, body: JSON.stringify(body) });
    },
    [roomId],
  );

  const control = useCallback(
    (action: ControlAction, position?: number, source?: VideoSource) => send('control', { action, position, source }),
    [send],
  );

  const sendChat = useCallback((text: string) => send('chat', { text }), [send]);

  const sendVoiceState = useCallback(
    (inVoice: boolean, muted: boolean, deafened: boolean) =>
      send('voice/state', { inVoice, muted, deafened }),
    [send],
  );

  const sendVoiceSignal = useCallback(
    (to: string | null, type: VoiceSignalPayload['type'], data?: unknown) =>
      send('voice/signal', { to, type, data }),
    [send],
  );

  const setVoiceSignalListener = useCallback((fn: ((sig: VoiceSignalPayload) => void) | null) => {
    voiceListenerRef.current = fn;
  }, []);

  /** Giờ hiện tại theo đồng hồ server (ms). */
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return {
    status,
    error,
    clearError: () => setError(null),
    state,
    chat,
    members,
    me,
    notice,
    control,
    sendChat,
    sendVoiceState,
    sendVoiceSignal,
    setVoiceSignalListener,
    serverNow,
  };
}
