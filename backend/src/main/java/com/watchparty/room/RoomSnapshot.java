package com.watchparty.room;

import java.util.List;

/** Toàn bộ trạng thái phòng, gửi riêng cho người vừa vào. */
public record RoomSnapshot(String roomId, String roomTitle, boolean hasPin, boolean isHost, String you,
                           PlaybackState state, List<ChatMessage> chat, List<Member> members, long serverTime) {
}
