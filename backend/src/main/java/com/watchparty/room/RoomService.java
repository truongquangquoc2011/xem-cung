package com.watchparty.room;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class RoomService {

    private static final Logger log = LoggerFactory.getLogger(RoomService.class);
    private static final String ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int ID_LENGTH = 6;
    private static final Duration EMPTY_ROOM_TTL = Duration.ofHours(24);

    private final Map<String, Room> rooms = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    public Room create() {
        while (true) {
            String id = randomId();
            Room room = new Room(id);
            if (rooms.putIfAbsent(id, room) == null) {
                log.info("Tạo phòng {}", id);
                return room;
            }
        }
    }

    public Optional<Room> find(String id) {
        return id == null ? Optional.empty() : Optional.ofNullable(rooms.get(id.toUpperCase()));
    }

    public Room get(String id) {
        return find(id).orElseThrow(() -> new RoomNotFoundException(id));
    }

    /** Xoá phòng không còn ai trong 24 giờ. */
    @Scheduled(fixedDelay = 5 * 60 * 1000)
    public void cleanup() {
        long cutoff = System.currentTimeMillis() - EMPTY_ROOM_TTL.toMillis();
        rooms.values().removeIf(r -> {
            boolean stale = r.memberCount() == 0 && r.getLastActive() < cutoff;
            if (stale) {
                log.info("Xoá phòng trống {}", r.getId());
            }
            return stale;
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
