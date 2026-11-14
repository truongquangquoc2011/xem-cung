package com.watchparty.security;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import com.watchparty.room.Room;
import com.watchparty.room.RoomService;

/**
 * Bảo vệ kênh STOMP:
 * <ol>
 *   <li>Client chỉ được SEND tới /app/** — không được gửi thẳng vào /topic hay /queue
 *       (nếu không, ai cũng giả được tin nhắn / lệnh phát của phòng khác).</li>
 *   <li>SUBSCRIBE /topic/room/{id} của phòng khoá PIN phải kèm header "pin" đúng
 *       (nếu không, biết mã phòng là nghe lén được chat và trạng thái phát).</li>
 * </ol>
 */
@Component
public class StompSecurityInterceptor implements ChannelInterceptor {

    private static final Pattern ROOM_TOPIC = Pattern.compile("^/topic/room/([A-Za-z0-9]{1,12})$");

    private final RoomService rooms;
    private final AbuseGuard guard;

    public StompSecurityInterceptor(RoomService rooms, AbuseGuard guard) {
        this.rooms = rooms;
        this.guard = guard;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor acc = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (acc == null || acc.getCommand() == null) {
            return message;
        }
        String dest = acc.getDestination();
        StompCommand cmd = acc.getCommand();

        if (cmd == StompCommand.SEND) {
            if (dest == null || !dest.startsWith("/app/")) {
                throw new MessagingException("Không được gửi trực tiếp tới " + dest);
            }
        } else if (cmd == StompCommand.SUBSCRIBE) {
            if (dest == null) {
                throw new MessagingException("Thiếu destination");
            }
            if (dest.startsWith("/topic/")) {
                Matcher m = ROOM_TOPIC.matcher(dest);
                if (!m.matches()) {
                    throw new MessagingException("Không được theo dõi " + dest);
                }
                checkRoomAccess(acc, m.group(1));
            } else if (!dest.startsWith("/user/queue/")) {
                throw new MessagingException("Không được theo dõi " + dest);
            }
        }
        return message;
    }

    private void checkRoomAccess(StompHeaderAccessor acc, String roomId) {
        Room room = rooms.find(roomId).orElse(null);
        if (room == null || !room.hasPin()) {
            return;
        }
        String clientKey = clientKey(acc);
        guard.checkPinAllowed(clientKey, room.getId());
        String pin = acc.getFirstNativeHeader("pin");
        if (!room.checkPin(pin)) {
            guard.recordPinFailure(clientKey, room.getId());
            throw new MessagingException("Mã PIN phòng không đúng");
        }
    }

    private static String clientKey(StompHeaderAccessor acc) {
        Map<String, Object> attrs = acc.getSessionAttributes();
        Object ip = attrs == null ? null : attrs.get(ClientIp.SESSION_ATTR);
        return ip == null ? "ws:" + acc.getSessionId() : ip.toString();
    }
}
