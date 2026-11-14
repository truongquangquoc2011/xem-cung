package com.watchparty.room;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.watchparty.room.Room.RoomSummary;

@RestController
@RequestMapping("/api")
public class RoomController {

    private final RoomService rooms;

    public RoomController(RoomService rooms) {
        this.rooms = rooms;
    }

    @GetMapping("/rooms")
    public List<RoomSummary> list() {
        return rooms.listRooms();
    }

    @PostMapping("/rooms")
    @ResponseStatus(HttpStatus.CREATED)
    public RoomSummary create(@RequestBody(required = false) Requests.CreateRoom req) {
        String title = req == null ? null : req.title();
        String pin = req == null ? null : req.pin();
        return rooms.create(title, pin).summary();
    }

    @GetMapping("/rooms/{id}")
    public RoomSummary info(@PathVariable String id) {
        Room room = rooms.get(id);
        return room.summary();
    }

    @PostMapping("/rooms/{id}/verify-pin")
    public Map<String, Object> verifyPin(@PathVariable String id,
                                         @RequestBody(required = false) Requests.VerifyPin req) {
        Room room = rooms.get(id);
        String candidate = req == null ? "" : req.pin();
        return Map.of("ok", room.checkPin(candidate));
    }

    /** Dùng để client ước lượng chênh lệch đồng hồ với server. */
    @GetMapping("/time")
    public Map<String, Object> time() {
        return Map.of("serverTime", System.currentTimeMillis());
    }
}
