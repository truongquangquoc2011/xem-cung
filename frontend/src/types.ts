export type SourceType = 'youtube' | 'video';

/** type = youtube: url là videoId. type = video: url là link mp4 / m3u8. */
export interface VideoSource {
  type: SourceType;
  url: string;
  title: string;
}

export interface PlaybackState {
  source?: VideoSource;
  playing: boolean;
  position: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  type: 'USER' | 'SYSTEM';
  user?: string;
  text: string;
  timestamp: number;
}

export interface Member {
  id: string;
  name: string;
  inVoice?: boolean;
  muted?: boolean;
  deafened?: boolean;
  host?: boolean;
}

export interface VoiceSignalPayload {
  from: string;
  fromName: string;
  to?: string | null;
  type: 'hello' | 'offer' | 'answer' | 'ice' | 'speaking';
  data?: unknown;
}

export interface RoomEvent {
  type: 'STATE' | 'CHAT' | 'MEMBERS' | 'VOICE' | 'CLOSED';
  state?: PlaybackState;
  message?: ChatMessage;
  members?: Member[];
  voice?: VoiceSignalPayload;
  by?: string;
  serverTime: number;
}

export interface RoomSummary {
  id: string;
  title: string;
  memberCount: number;
  hasPin: boolean;
  pinned: boolean;
  playingTitle?: string;
  hostToken?: string;
}

export interface RoomSnapshot {
  roomId: string;
  roomTitle?: string;
  hasPin?: boolean;
  isHost?: boolean;
  you: string;
  state: PlaybackState;
  chat: ChatMessage[];
  members: Member[];
  serverTime: number;
}

export type ControlAction = 'play' | 'pause' | 'seek' | 'load';

export interface MovieSummary {
  id: string;
  title: string;
  originalTitle?: string;
  year?: string;
  poster?: string;
  backdrop?: string;
  currentEpisode?: string;
  quality?: string;
}

export interface MoviePage {
  items: MovieSummary[];
  page: number;
  totalPages: number;
}

export interface Episode {
  name: string;
  url: string;
}

export interface MovieDetail {
  id: string;
  title: string;
  originalTitle?: string;
  description?: string;
  year?: string;
  poster?: string;
  episodes: Episode[];
}

export interface SkipSegment {
  type: 'op' | 'ed';
  startTime: number;
  endTime: number;
}

/** Điều khiển chung cho cả trình phát YouTube và <video>. */
export interface PlayerHandle {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  getTime(): number;
  isPlaying(): boolean;
  /** Đang tua dở (chờ tải đoạn mới). Lúc này không được tự kéo về giờ phòng. */
  isSeeking?(): boolean;
}
