package com.watchparty.room;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.watchparty.room.Room.RoomSummary;

@Service
public class RoomService {

    private static final Logger log = LoggerFactory.getLogger(RoomService.class);
    private static final String ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int ID_LENGTH = 6;
    private static final Duration EMPTY_ROOM_TTL = Duration.ofMinutes(15);
    private static final Duration IDLE_ROOM_TTL = Duration.ofMinutes(45);
    /** Trần số phòng trong RAM, chống bị spam tạo phòng làm đầy bộ nhớ. */
    private static final int MAX_ROOMS = 500;

    private final Map<String, Room> rooms = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private final SimpMessagingTemplate broker;

    public RoomService() {
        this(null);
    }

    @Autowired
    public RoomService(@Lazy SimpMessagingTemplate broker) {
        this.broker = broker;
    }

    @PostConstruct
    public void initDefaultRooms() {
        createPreset("CINEMA", "🍿 Rạp Chung 24/7");
        createPreset("ANIME1", "⚔️ Hội Cày Anime");
        createPreset("PHIMVN", "🇻🇳 Rạp Phim Việt");
        createPreset("PHIMAI", "✦ Động Tiên Hiệp AI");
    }

    private void createPreset(String id, String title) {
        rooms.putIfAbsent(id, new Room(id, title, null, true));
    }

    public Room create() {
        return create(null, null);
    }

    public Room create(String title, String pin) {
        String cleanTitle = title == null ? "" : title.strip();
        if (cleanTitle.length() > 60) {
            cleanTitle = cleanTitle.substring(0, 60);
        }
        String cleanPin = pin == null ? "" : pin.strip();
        if (cleanPin.length() > 20) {
            cleanPin = cleanPin.substring(0, 20);
        }
        if (rooms.size() >= MAX_ROOMS) {
            cleanup();
            if (rooms.size() >= MAX_ROOMS) {
                throw new com.watchparty.security.TooManyRequestsException("Server đang quá nhiều phòng, thử lại sau.");
            }
        }
        while (true) {
            String id = randomId();
            String finalTitle = cleanTitle.isEmpty() ? ("Phòng " + id) : cleanTitle;
            Room room = new Room(id, finalTitle, cleanPin, false);
            if (rooms.putIfAbsent(id, room) == null) {
                log.info("Tạo phòng {} (khóa PIN: {})", id, room.hasPin());
                return room;
            }
        }
    }

    public List<RoomSummary> listRooms() {
        return rooms.values().stream()
                .sorted(Comparator
                        .comparing((Room r) -> r.memberCount() > 0).reversed()
                        .thenComparing(Room::isPinned).reversed()
                        .thenComparingLong(Room::getLastActive).reversed())
                .limit(24)
                .map(Room::summary)
                .toList();
    }

    public Optional<Room> find(String id) {
        return id == null ? Optional.empty() : Optional.ofNullable(rooms.get(id.toUpperCase()));
    }

    public Room get(String id) {
        return find(id).orElseThrow(() -> new RoomNotFoundException(id));
    }

    /** Chủ phòng đóng phòng: ngắt kết nối toàn bộ người đang xem và xoá phòng ngay lập tức. */
    public void closeRoom(String id, String sessionId, String hostToken) {
        Room room = get(id);
        if (!room.isHost(sessionId, hostToken)) {
            throw new IllegalArgumentException("Chỉ chủ phòng mới có quyền đóng phòng");
        }
        rooms.remove(room.getId());
        log.info("Chủ phòng đóng phòng {}", room.getId());
        if (broker != null) {
            broker.convertAndSend("/topic/room/" + room.getId(),
                    RoomEvent.closed("Chủ phòng đã đóng phòng", System.currentTimeMillis()));
        }
    }

    /** Xoá phòng trống quá 15 phút hoặc phòng không có phản hồi/thao tác quá 45 phút. */
    @Scheduled(fixedDelay = 60 * 1000)
    public void cleanup() {
        long now = System.currentTimeMillis();
        long emptyCutoff = now - EMPTY_ROOM_TTL.toMillis();
        long idleCutoff = now - IDLE_ROOM_TTL.toMillis();
        rooms.values().removeIf(r -> {
            if (r.isPinned()) {
                return false;
            }
            boolean emptyStale = r.memberCount() == 0 && r.getLastActive() < emptyCutoff;
            boolean idleStale = r.getLastActive() < idleCutoff;
            if (emptyStale || idleStale) {
                log.info("Xoá phòng {} (trống={}, không phản hồi={})", r.getId(), emptyStale, idleStale);
                if (idleStale && r.memberCount() > 0 && broker != null) {
                    broker.convertAndSend("/topic/room/" + r.getId(),
                            RoomEvent.closed("Phòng đã tự đóng do không có hoạt động", now));
                }
                return true;
            }
            return false;
        });
    }

    private String randomId() {
        StringBuilder sb = new StringBuilder(ID_LENGTH);
        for (int i = 0; i < ID_LENGTH; i++) {
            sb.append(ID_CHARS.charAt(random.nextInt(ID_CHARS.length())));
        }
        return sb.toString();
    }
}
