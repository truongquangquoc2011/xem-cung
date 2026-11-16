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

import com.watchparty.room.Room.RoomSummary;
import com.watchparty.security.AbuseGuard;
import com.watchparty.security.ClientIp;

import jakarta.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/api")
public class RoomController {

    private final RoomService rooms;
    private final AbuseGuard guard;

    public RoomController(RoomService rooms, AbuseGuard guard) {
        this.rooms = rooms;
        this.guard = guard;
    }

    @GetMapping("/rooms")
    public List<RoomSummary> list() {
        return rooms.listRooms();
    }

    @PostMapping("/rooms")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@RequestBody(required = false) Requests.CreateRoom req, HttpServletRequest http) {
        guard.checkRoomCreation(ClientIp.of(http));
        String title = req == null ? null : req.title();
        String pin = req == null ? null : req.pin();
        Room created = rooms.create(title, pin);
        RoomSummary s = created.summary();
        return Map.of(
                "id", s.id(),
                "title", s.title(),
                "memberCount", s.memberCount(),
                "hasPin", s.hasPin(),
                "pinned", s.pinned(),
                "hostToken", created.getHostToken()
        );
    }

    @PostMapping("/rooms/{id}/close")
    public Map<String, Object> close(@PathVariable String id,
                                     @RequestBody(required = false) Requests.CloseRoom req) {
        rooms.closeRoom(id, null, req == null ? null : req.hostToken());
        return Map.of("ok", true);
    }

    @GetMapping("/rooms/{id}")
    public RoomSummary info(@PathVariable String id) {
        Room room = rooms.get(id);
        return room.summary();
    }

    @PostMapping("/rooms/{id}/verify-pin")
    public Map<String, Object> verifyPin(@PathVariable String id,
                                         @RequestBody(required = false) Requests.VerifyPin req,
                                         HttpServletRequest http) {
        Room room = rooms.get(id);
        String client = ClientIp.of(http);
        // Chống dò PIN: sai quá nhiều lần sẽ bị khoá tạm thời (HTTP 429)
        guard.checkPinAllowed(client, room.getId());
        String candidate = req == null ? "" : req.pin();
        boolean ok = room.checkPin(candidate);
        if (ok) {
            guard.recordPinSuccess(client, room.getId());
        } else {
            guard.recordPinFailure(client, room.getId());
        }
        return Map.of("ok", ok);
    }

    /** Dùng để client ước lượng chênh lệch đồng hồ với server. */
    @GetMapping("/time")
    public Map<String, Object> time() {
        return Map.of("serverTime", System.currentTimeMillis());
    }
}
