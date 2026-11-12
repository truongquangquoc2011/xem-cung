package com.watchparty.room;

/** type = "USER" (tin nhắn người dùng) hoặc "SYSTEM" (ai đó vào/ra, đổi phim...). */
public record ChatMessage(String id, String type, String user, String text, long timestamp) {
}
