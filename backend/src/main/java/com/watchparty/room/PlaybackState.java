package com.watchparty.room;

/**
 * Trạng thái phát của phòng.
 * Vị trí thực tế lúc này = position + (now - updatedAt) / 1000 nếu playing = true.
 */
public record PlaybackState(VideoSource source, boolean playing, double position, long updatedAt) {

    public double positionAt(long now) {
        if (!playing) {
            return position;
        }
        return position + Math.max(0, now - updatedAt) / 1000.0;
    }
}
