package com.watchparty.security;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Các hạn mức chống lạm dụng dùng chung cho REST và WebSocket.
 *
 * <ul>
 *   <li>Đoán PIN: tối đa 5 lần sai / 5 phút cho mỗi IP + phòng, và 30 lần sai / 5 phút cho mỗi phòng.</li>
 *   <li>Tạo phòng: tối đa 10 phòng / 10 phút cho mỗi IP.</li>
 *   <li>Chat: 8 tin / 5 giây; điều khiển phát: 20 lệnh / 5 giây (mỗi kết nối).</li>
 *   <li>Voice: tín hiệu kết nối WebRTC (offer/answer/ice) 400 / 5 giây — rộng để không rơi gói ICE;
 *       tín hiệu "đang nói" 25 / 5 giây; đổi trạng thái mic 30 / 5 giây.</li>
 * </ul>
 */
@Component
public class AbuseGuard {

    private final RateLimiter pinFailuresByClient = new RateLimiter(5, 5 * 60_000L);
    private final RateLimiter pinFailuresByRoom = new RateLimiter(30, 5 * 60_000L);
    private final RateLimiter roomCreation = new RateLimiter(10, 10 * 60_000L);
    private final RateLimiter chat = new RateLimiter(8, 5_000L);
    private final RateLimiter control = new RateLimiter(20, 5_000L);
    /** Tín hiệu bắt tay WebRTC: phải rộng, rơi 1 gói ICE là kết nối dễ treo. */
    private final RateLimiter voiceSignal = new RateLimiter(400, 5_000L);
    private final RateLimiter voiceSpeaking = new RateLimiter(25, 5_000L);
    private final RateLimiter voiceState = new RateLimiter(30, 5_000L);

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

    /** Tín hiệu voice quá nhiều thì bỏ qua lặng lẽ (không báo lỗi làm phiền). Mỗi loại một hạn mức riêng. */
    public boolean allowVoiceSignal(String sessionId, String type) {
        return "speaking".equals(type) ? voiceSpeaking.tryAcquire(sessionId) : voiceSignal.tryAcquire(sessionId);
    }

    public boolean allowVoiceState(String sessionId) {
        return voiceState.tryAcquire(sessionId);
    }

    public void forgetSession(String sessionId) {
        chat.reset(sessionId);
        control.reset(sessionId);
        voiceSignal.reset(sessionId);
        voiceSpeaking.reset(sessionId);
        voiceState.reset(sessionId);
    }

    @Scheduled(fixedDelay = 60_000L)
    public void cleanup() {
        pinFailuresByClient.cleanup();
        pinFailuresByRoom.cleanup();
        roomCreation.cleanup();
        chat.cleanup();
        control.cleanup();
        voiceSignal.cleanup();
        voiceSpeaking.cleanup();
        voiceState.cleanup();
    }
}
