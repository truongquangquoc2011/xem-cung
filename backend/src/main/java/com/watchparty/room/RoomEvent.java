package com.watchparty.room;

import java.util.List;

/**
 * Sự kiện phát tới /topic/room/{id}.
 * type = STATE | CHAT | MEMBERS; chỉ trường tương ứng có giá trị.
 */
public record RoomEvent(String type, PlaybackState state, ChatMessage message, List<Member> members,
                        String by, long serverTime) {

    public static RoomEvent state(PlaybackState s, String by, long now) {
        return new RoomEvent("STATE", s, null, null, by, now);
    }

    public static RoomEvent chat(ChatMessage m, long now) {
        return new RoomEvent("CHAT", null, m, null, null, now);
    }

    public static RoomEvent members(List<Member> m, long now) {
        return new RoomEvent("MEMBERS", null, null, m, null, now);
    }
}
