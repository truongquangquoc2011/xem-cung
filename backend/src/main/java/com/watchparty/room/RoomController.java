package com.watchparty.room;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class RoomController {

    private final RoomService rooms;

    public RoomController(RoomService rooms) {
        this.rooms = rooms;
    }

    @PostMapping("/rooms")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create() {
        return Map.of("id", rooms.create().getId());
    }

    @GetMapping("/rooms/{id}")
    public Map<String, Object> info(@PathVariable String id) {
        Room room = rooms.get(id);
        return Map.of("id", room.getId(), "memberCount", room.memberCount());
    }

    /** Dùng để client ước lượng chênh lệch đồng hồ với server. */
    @GetMapping("/time")
    public Map<String, Object> time() {
        return Map.of("serverTime", System.currentTimeMillis());
    }
}
