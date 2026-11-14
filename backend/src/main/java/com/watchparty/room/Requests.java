package com.watchparty.room;

/** Payload client gửi lên qua STOMP. */
public final class Requests {

    private Requests() {
    }

    public record Join(String name) {
    }

    public record Chat(String text) {
    }

    /** action = play | pause | seek | load. source chỉ cần khi load. */
    public record Control(String action, Double position, VideoSource source) {
    }

    /** Cập nhật trạng thái tham gia kênh thoại (Voice Chat) của thành viên. */
    public record VoiceState(boolean inVoice, boolean muted, boolean deafened) {
    }

    /** Tín hiệu WebRTC (offer / answer / ice / hello) gửi giữa các thành viên trong phòng. */
    public record VoiceSignal(String to, String type, Object data) {
    }
}
