package com.watchparty.security;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Các hạn mức chống lạm dụng dùng chung cho REST và WebSocket.
 *
 * <ul>
 *   <li>Đoán PIN: tối đa 5 lần sai / 5 phút cho mỗi IP + phòng, và 30 lần sai / 5 phút cho mỗi phòng.</li>
 *   <li>Tạo phòng: tối đa 10 phòng / 10 phút cho mỗi IP.</li>
 *   <li>Chat: 8 tin / 5 giây; điều khiển phát: 20 lệnh / 5 giây; tín hiệu voice: 120 / 5 giây (mỗi kết nối).</li>
 * </ul>
 */
@Component
public class AbuseGuard {

    private final RateLimiter pinFailuresByClient = new RateLimiter(5, 5 * 60_000L);
    private final RateLimiter pinFailuresByRoom = new RateLimiter(30, 5 * 60_000L);
    private final RateLimiter roomCreation = new RateLimiter(10, 10 * 60_000L);
    private final RateLimiter chat = new RateLimiter(8, 5_000L);
    private final RateLimiter control = new RateLimiter(20, 5_000L);
    private final RateLimiter voice = new RateLimiter(120, 5_000L);

    /** Ném lỗi nếu IP này (hoặc cả phòng) đã nhập sai PIN quá nhiều lần. */
    public void checkPinAllowed(String clientKey, String roomId) {
        if (pinFailuresByClient.isBlocked(clientKey + "|" + roomId) || pinFailuresByRoom.isBlocked(roomId)) {
            throw new TooManyRequestsException("Nhập sai PIN quá nhiều lần, thử lại sau vài phút.");
        }
    }

    public void recordPinFailure(String clientKey, String roomId) {
        pinFailuresByClient.record(clientKey + "|" + roomId);
        pinFailuresByRoom.record(roomId);
    }

    public void recordPinSuccess(String clientKey, String roomId) {
        pinFailuresByClient.reset(clientKey + "|" + roomId);
    }

    public void checkRoomCreation(String clientKey) {
        if (!roomCreation.tryAcquire(clientKey)) {
            throw new TooManyRequestsException("Bạn tạo phòng quá nhanh, thử lại sau ít phút.");
        }
    }

    public void checkChat(String sessionId) {
        if (!chat.tryAcquire(sessionId)) {
            throw new TooManyRequestsException("Bạn gửi tin nhắn quá nhanh.");
        }
    }

    public void checkControl(String sessionId) {
        if (!control.tryAcquire(sessionId)) {
            throw new TooManyRequestsException("Thao tác quá nhanh, chậm lại chút nhé.");
        }
    }

    /** Tín hiệu voice quá nhiều thì bỏ qua lặng lẽ (không báo lỗi làm phiền). */
    public boolean allowVoice(String sessionId) {
        return voice.tryAcquire(sessionId);
    }

    public void forgetSession(String sessionId) {
        chat.reset(sessionId);
        control.reset(sessionId);
        voice.reset(sessionId);
    }

    @Scheduled(fixedDelay = 60_000L)
    public void cleanup() {
        pinFailuresByClient.cleanup();
        pinFailuresByRoom.cleanup();
        roomCreation.cleanup();
        chat.cleanup();
        control.cleanup();
        voice.cleanup();
    }
}
