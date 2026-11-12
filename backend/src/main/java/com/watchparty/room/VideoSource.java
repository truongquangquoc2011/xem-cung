package com.watchparty.room;

/**
 * Nguồn video đang chiếu trong phòng.
 *
 * @param type  "youtube" (url = videoId 11 ký tự) hoặc "video" (url = link mp4 / m3u8)
 * @param url   videoId YouTube hoặc link video
 * @param title tên hiển thị
 */
public record VideoSource(String type, String url, String title) {
}
