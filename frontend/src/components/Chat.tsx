import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage } from '../types';
import { colorFor, initials, isEmojiOnly } from '../utils';

const QUICK_EMOJI = ['😂', '😍', '😮', '😢', '👏', '🔥'];

interface Props {
  messages: ChatMessage[];
  myName: string;
  memberCount: number;
  onSend(text: string): void;
  disabled?: boolean;
}

function time(ts: number) {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function Chat({ messages, myName, memberCount, onSend, disabled }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
    stickToBottom.current = true;
  };

  return (
    <section className="chat" aria-label="Trò chuyện">
      <header className="panel-head">
        <h2>Trò chuyện</h2>
        <span className="muted small">{memberCount} người trong phòng</span>
      </header>

      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 && (
          <div className="chat-empty">
            <span aria-hidden="true">🍿</span>
            <p>Chưa có tin nhắn. Chào mọi người đi!</p>
          </div>
        )}
        {messages.map((m) =>
          m.type === 'SYSTEM' ? (
            <p key={m.id} className="chat-system">
              {m.text}
            </p>
          ) : (
            <div key={m.id} className={`chat-msg ${m.user === myName ? 'mine' : ''}`}>
              <span className="avatar sm" style={{ background: colorFor(m.user ?? '') }} aria-hidden="true">
                {initials(m.user ?? '')}
              </span>
              <div className="chat-body">
                <div className="chat-meta">
                  <span className="chat-user" style={{ color: colorFor(m.user ?? '') }}>
                    {m.user}
                  </span>
                  <span className="chat-time">{time(m.timestamp)}</span>
                </div>
                <div className={`chat-bubble ${isEmojiOnly(m.text) ? 'emoji' : ''}`}>{m.text}</div>
              </div>
            </div>
          ),
        )}
      </div>

      <div className="emoji-bar">
        {QUICK_EMOJI.map((e) => (
          <button key={e} type="button" className="emoji-btn" disabled={disabled} onClick={() => onSend(e)} title="Thả cảm xúc">
            {e}
          </button>
        ))}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? 'Đang kết nối…' : 'Nhắn gì đó…'}
          maxLength={500}
          disabled={disabled}
          aria-label="Tin nhắn"
        />
        <button className="btn btn-primary" disabled={disabled || !text.trim()}>
          Gửi
        </button>
      </form>
    </section>
  );
}
