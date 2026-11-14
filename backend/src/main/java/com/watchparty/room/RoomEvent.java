package com.watchparty.room;

import java.util.List;

/**
 * Sự kiện phát tới /topic/room/{id}.
 * type = STATE | CHAT | MEMBERS | VOICE; chỉ trường tương ứng có giá trị.
 */
public record RoomEvent(String type, PlaybackState state, ChatMessage message, List<Member> members,
                        VoiceSignalPayload voice, String by, long serverTime) {

    public record VoiceSignalPayload(String from, String fromName, String to, String type, Object data) {
    }

    public static RoomEvent state(PlaybackState s, String by, long now) {
        return new RoomEvent("STATE", s, null, null, null, by, now);
    }

    public static RoomEvent chat(ChatMessage m, long now) {
        return new RoomEvent("CHAT", null, m, null, null, null, now);
    }

    public static RoomEvent members(List<Member> m, long now) {
        return new RoomEvent("MEMBERS", null, null, m, null, null, now);
    }

    public static RoomEvent voice(VoiceSignalPayload v, long now) {
        return new RoomEvent("VOICE", null, null, null, v, v.fromName(), now);
    }
}
