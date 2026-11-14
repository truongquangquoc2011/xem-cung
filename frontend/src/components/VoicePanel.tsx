import { useState } from 'react';
import type { useVoiceChat } from '../hooks/useVoiceChat';
import type { Member } from '../types';
import { colorFor, initials } from '../utils';

interface Props {
  me: string | null;
  members: Member[];
  connected: boolean;
  voice: ReturnType<typeof useVoiceChat>;
}

const METER_SEGMENTS = 32;

/**
 * Bảng Kênh Thoại (Voice Channel) & Kiểm tra Mic kiểu Discord.
 */
export function VoicePanel({ me, members, connected, voice }: Props) {
  const [testOpen, setTestOpen] = useState(false);

  const voiceMembers = members.filter((m) => m.inVoice || (m.id === me && voice.inVoice));

  return (
    <section className="voice-panel" aria-label="Kênh thoại Voice Chat">
      <div className="voice-header">
        <div className="voice-title-group">
          <span className={`voice-signal-dot ${voice.inVoice ? 'live' : voiceMembers.length > 0 ? 'active' : ''}`} />
          <div>
            <h3 className="voice-title">🔊 Kênh thoại phòng</h3>
            <p className="voice-sub">
              {voice.inVoice
                ? 'Đã kết nối giọng nói · WebRTC'
                : voiceMembers.length > 0
                  ? `${voiceMembers.length} người đang ở kênh thoại`
                  : 'Trò chuyện bằng giọng nói như Discord'}
            </p>
          </div>
        </div>

        <div className="voice-head-actions">
          <button
            type="button"
            className={`voice-btn ghost ${testOpen || voice.testingMic ? 'active' : ''}`}
            onClick={() => setTestOpen((o) => !o)}
            title="Kiểm tra Mic & Loa"
          >
            🎛️ Test Voice
          </button>

          {!voice.inVoice ? (
            <button
              type="button"
              className="voice-btn join"
              disabled={!connected}
              onClick={() => void voice.joinVoice()}
            >
              🎧 Tham gia Voice
            </button>
          ) : (
            <button
              type="button"
              className="voice-btn leave"
              onClick={voice.leaveVoice}
              title="Rời kênh thoại"
            >
              📞 Rời Voice
            </button>
          )}
        </div>
      </div>

      {/* Danh sách người đang trong kênh thoại */}
      <div className="voice-members">
        {voiceMembers.length === 0 ? (
          <div className="voice-empty">
            <span>🎙️</span>
            <span>Chưa có ai trong kênh thoại. Bấm <strong>Tham gia Voice</strong> hoặc <strong>Test Voice</strong> để thử mic!</span>
          </div>
        ) : (
          voiceMembers.map((m) => {
            const isMe = m.id === me;
            const isMuted = isMe ? voice.muted : Boolean(m.muted);
            const isDeafened = isMe ? voice.deafened : Boolean(m.deafened);
            const isSpeaking = Boolean(voice.speakingIds[m.id]) && !isMuted && !isDeafened;
            const peerState = !isMe ? voice.peerStatuses[m.id] : undefined;

            return (
              <div key={m.id} className={`voice-member ${isSpeaking ? 'speaking' : ''}`}>
                <div className={`voice-avatar-wrap ${isSpeaking ? 'speaking' : ''}`}>
                  <span className="avatar sm" style={{ background: colorFor(m.name) }}>
                    {initials(m.name)}
                  </span>
                </div>
                <div className="voice-member-info">
                  <span className="voice-member-name">
                    {m.name} {isMe && <em className="voice-you">(Bạn)</em>}
                  </span>
                  <span className="voice-member-state">
                    {isDeafened
                      ? '🔕 Đã tắt tiếng'
                      : isMuted
                        ? '🔇 Đã tắt mic'
                        : isSpeaking
                          ? '🟢 Đang nói…'
                          : isMe
                            ? 'Đã kết nối'
                            : peerState === 'connected'
                              ? 'Đã kết nối RTC'
                              : 'Đang đồng bộ…'}
                  </span>
                </div>
                <div className="voice-member-icons">
                  <span className={`voice-state-icon ${isMuted ? 'off' : 'on'}`} title={isMuted ? 'Đã tắt mic' : 'Mic đang bật'}>
                    {isMuted ? '🔇' : '🎤'}
                  </span>
                  <span className={`voice-state-icon ${isDeafened ? 'off' : 'on'}`} title={isDeafened ? 'Đã tắt loa' : 'Loa đang bật'}>
                    {isDeafened ? '🔕' : '🎧'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Thanh điều khiển nhanh khi đang ở trong Voice (giống thanh dưới cùng của Discord) */}
      {voice.inVoice && (
        <div className="voice-controls-bar">
          <button
            type="button"
            className={`voice-ctrl-btn ${voice.muted ? 'danger' : ''}`}
            onClick={voice.toggleMute}
            title={voice.muted ? 'Bật lại Mic' : 'Tắt Mic'}
          >
            <span>{voice.muted ? '🔇' : '🎤'}</span>
            <span>{voice.muted ? 'Bật Mic' : 'Tắt Mic'}</span>
          </button>

          <button
            type="button"
            className={`voice-ctrl-btn ${voice.deafened ? 'danger' : ''}`}
            onClick={voice.toggleDeafen}
            title={voice.deafened ? 'Bật lại âm thanh kênh thoại' : 'Tắt tiếng kênh thoại (Deafen)'}
          >
            <span>{voice.deafened ? '🔕' : '🎧'}</span>
            <span>{voice.deafened ? 'Bật Loa' : 'Tắt Loa'}</span>
          </button>

          <div className="voice-mini-meter" title={`Âm lượng mic hiện tại: ${voice.micLevel}%`}>
            <div className="voice-mini-fill" style={{ width: `${voice.micLevel}%` }} />
          </div>
        </div>
      )}

      {/* Khu vực Test Voice kiểu Discord ("Mic Test / Let's Check") */}
      {(testOpen || voice.testingMic) && (
        <div className="voice-test-box" aria-label="Kiểm tra giọng nói kiểu Discord">
          <div className="voice-test-head">
            <strong>🎙️ Kiểm tra giọng nói (Discord Mic Test)</strong>
            <span className="voice-test-badge">
              {voice.testingMic ? '● Đang thu & phát lại' : 'Sẵn sàng'}
            </span>
          </div>

          <div className="voice-test-grid">
            <label className="voice-field">
              <span>Thiết bị thu (Microphone)</span>
              <select
                value={voice.selectedMicId}
                onChange={(e) => voice.setSelectedMicId(e.target.value)}
                disabled={voice.demoMic}
              >
                <option value="">Mặc định của hệ thống</option>
                {voice.micDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="voice-sliders-row">
              <label className="voice-field">
                <span>Âm lượng thu (Mic): {voice.micGainPct}%</span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={voice.micGainPct}
                  onChange={(e) => voice.setMicGainPct(Number(e.target.value))}
                />
              </label>

              <label className="voice-field">
                <span>Âm lượng nghe (Loa): {voice.outputVolPct}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={voice.outputVolPct}
                  onChange={(e) => voice.setOutputVolPct(Number(e.target.value))}
                />
              </label>
            </div>
          </div>

          {/* Thanh đo 32 vạch kiểu Discord */}
          <div className="discord-mic-test">
            <div className="discord-mic-actions">
              <button
                type="button"
                className={`voice-btn ${voice.testingMic ? 'leave' : 'join'}`}
                onClick={() => void voice.toggleTestMic()}
              >
                {voice.testingMic ? '⏹ Dừng kiểm tra' : '🎙️ Bắt đầu Test Mic'}
              </button>

              <button
                type="button"
                className="voice-btn ghost"
                onClick={voice.playTestSpeaker}
                title="Phát âm báo để kiểm tra loa/tai nghe"
              >
                🔊 Test Loa
              </button>
            </div>

            <div className="discord-meter-wrap" aria-label={`Mức âm thanh mic ${voice.micLevel}%`}>
              <div className="discord-meter-bars">
                {Array.from({ length: METER_SEGMENTS }).map((_, idx) => {
                  const pct = ((idx + 1) / METER_SEGMENTS) * 100;
                  const active = voice.micLevel >= pct - 2;
                  const zone = pct > 80 ? 'high' : pct > 55 ? 'mid' : 'low';
                  return (
                    <span
                      key={idx}
                      className={`discord-bar ${zone} ${active ? 'lit' : ''}`}
                    />
                  );
                })}
              </div>
              <div
                className="discord-threshold-line"
                style={{ left: `${voice.sensitivity}%` }}
                title={`Ngưỡng nhạy phát hiện tiếng nói: ${voice.sensitivity}%`}
              />
            </div>

            <div className="discord-meter-foot">
              <span>Mức tín hiệu: <strong>{voice.micLevel}%</strong></span>
              <label className="voice-demo-toggle">
                <input
                  type="checkbox"
                  checked={voice.demoMic}
                  onChange={(e) => void voice.toggleDemoMic(e.target.checked)}
                />
                <span>🤖 Giả lập giọng nói (test khi không có mic)</span>
              </label>
            </div>
          </div>

          {voice.voiceError && <p className="voice-hint">{voice.voiceError}</p>}
        </div>
      )}
    </section>
  );
}
