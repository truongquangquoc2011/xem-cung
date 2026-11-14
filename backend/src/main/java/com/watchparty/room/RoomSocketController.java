package com.watchparty.room;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

/**
 * Xử lý tin nhắn realtime của phòng.
 * Mỗi kết nối WebSocket chỉ ở trong 1 phòng; roomId lưu trong session attributes.
 */
@Controller
public class RoomSocketController {

    private static final Logger log = LoggerFactory.getLogger(RoomSocketController.class);
    private static final String ATTR_ROOM = "roomId";
    private static final int MAX_NAME_LENGTH = 30;

    private final RoomService rooms;
    private final SimpMessagingTemplate broker;

    public RoomSocketController(RoomService rooms, SimpMessagingTemplate broker) {
        this.rooms = rooms;
        this.broker = broker;
    }

    @MessageMapping("/room/{roomId}/join")
    @SendToUser(destinations = "/queue/snapshot", broadcast = false)
    public RoomSnapshot join(@DestinationVariable String roomId, Requests.Join req,
                             SimpMessageHeaderAccessor headers) {
        String sid = headers.getSessionId();
        Room room = rooms.get(roomId);

        Map<String, Object> attrs = headers.getSessionAttributes();
        Object previous = attrs.get(ATTR_ROOM);
        if (previous != null && !previous.equals(room.getId())) {
            leave(previous.toString(), sid);
        }
        attrs.put(ATTR_ROOM, room.getId());

        Member m = room.join(sid, cleanName(req == null ? null : req.name()));
        long now = System.currentTimeMillis();
        publish(room, RoomEvent.members(room.members(), now));
        publishChat(room, room.addChat("SYSTEM", null, m.name() + " đã vào phòng"));
        return room.snapshot(sid, System.currentTimeMillis());
    }

    @MessageMapping("/room/{roomId}/control")
    public void control(@DestinationVariable String roomId, Requests.Control req,
                        SimpMessageHeaderAccessor headers) {
        Room room = rooms.get(roomId);
        Member m = requireMember(room, headers);
        long now = System.currentTimeMillis();
        PlaybackState state = room.control(req, now);
        publish(room, RoomEvent.state(state, m.name(), now));
        if ("load".equals(req.action())) {
            publishChat(room, room.addChat("SYSTEM", null,
                    m.name() + " đã chọn: " + state.source().title()));
        }
    }

    @MessageMapping("/room/{roomId}/chat")
    public void chat(@DestinationVariable String roomId, Requests.Chat req, SimpMessageHeaderAccessor headers) {
        Room room = rooms.get(roomId);
        Member m = requireMember(room, headers);
        publishChat(room, room.addChat("USER", m.name(), req == null ? null : req.text()));
    }

    @MessageMapping("/room/{roomId}/voice/state")
    public void voiceState(@DestinationVariable String roomId, Requests.VoiceState req,
                           SimpMessageHeaderAccessor headers) {
        if (req == null) return;
        Room room = rooms.get(roomId);
        Member prev = requireMember(room, headers);
        Member updated = room.updateVoiceState(headers.getSessionId(), req.inVoice(), req.muted(), req.deafened());
        if (updated != null) {
            long now = System.currentTimeMillis();
            publish(room, RoomEvent.members(room.members(), now));
            if (!prev.inVoice() && updated.inVoice()) {
                publishChat(room, room.addChat("SYSTEM", null, updated.name() + " đã tham gia kênh thoại 🎙️"));
            } else if (prev.inVoice() && !updated.inVoice()) {
                publishChat(room, room.addChat("SYSTEM", null, updated.name() + " đã rời kênh thoại"));
            }
        }
    }

    @MessageMapping("/room/{roomId}/voice/signal")
    public void voiceSignal(@DestinationVariable String roomId, Requests.VoiceSignal req,
                            SimpMessageHeaderAccessor headers) {
        if (req == null || req.type() == null) return;
        Room room = rooms.get(roomId);
        Member sender = requireMember(room, headers);
        long now = System.currentTimeMillis();
        RoomEvent.VoiceSignalPayload payload = new RoomEvent.VoiceSignalPayload(
                sender.id(), sender.name(), req.to(), req.type(), req.data());
        publish(room, RoomEvent.voice(payload, now));
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        StompHeaderAccessor headers = StompHeaderAccessor.wrap(event.getMessage());
        Map<String, Object> attrs = headers.getSessionAttributes();
        Object roomId = attrs == null ? null : attrs.get(ATTR_ROOM);
        if (roomId != null) {
            leave(roomId.toString(), event.getSessionId());
        }
    }

    @MessageExceptionHandler
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public Map<String, String> handleError(Exception e) {
        log.debug("Lỗi xử lý tin nhắn: {}", e.getMessage());
        String message = (e instanceof IllegalArgumentException || e instanceof RoomNotFoundException)
                ? e.getMessage() : "Có lỗi xảy ra";
        return Map.of("message", message);
    }

    private void leave(String roomId, String sid) {
        rooms.find(roomId).ifPresent(room -> {
            Member m = room.leave(sid);
            if (m != null) {
                long now = System.currentTimeMillis();
                publish(room, RoomEvent.members(room.members(), now));
                publishChat(room, room.addChat("SYSTEM", null, m.name() + " đã rời phòng"));
            }
        });
    }

    private Member requireMember(Room room, SimpMessageHeaderAccessor headers) {
        Member m = room.member(headers.getSessionId());
        if (m == null) {
            throw new IllegalArgumentException("Bạn chưa vào phòng");
        }
        return m;
    }

    private void publishChat(Room room, ChatMessage msg) {
        if (msg != null) {
            publish(room, RoomEvent.chat(msg, System.currentTimeMillis()));
        }
    }

    private void publish(Room room, RoomEvent event) {
        broker.convertAndSend("/topic/room/" + room.getId(), event);
    }

    private static String cleanName(String name) {
        String n = name == null ? "" : name.strip();
        if (n.isEmpty()) {
            return "Khách";
        }
        return n.length() > MAX_NAME_LENGTH ? n.substring(0, MAX_NAME_LENGTH) : n;
    }
}
