package com.watchparty.room;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/** Một phòng xem chung. Lưu trong bộ nhớ; mọi thao tác đều synchronized. */
public class Room {

    private static final int MAX_CHAT_HISTORY = 100;
    private static final int MAX_CHAT_LENGTH = 500;
    private static final int MAX_TITLE_LENGTH = 200;
    private static final Pattern YOUTUBE_ID = Pattern.compile("[A-Za-z0-9_-]{11}");

    private final String id;
    private final Map<String, Member> members = new LinkedHashMap<>();
    private final Deque<ChatMessage> chat = new ArrayDeque<>();
    private PlaybackState state;
    private volatile long lastActive;

    public Room(String id) {
        this.id = id;
        long now = System.currentTimeMillis();
        this.state = new PlaybackState(null, false, 0, now);
        this.lastActive = now;
    }

    public String getId() {
        return id;
    }

    public long getLastActive() {
        return lastActive;
    }

    public synchronized int memberCount() {
        return members.size();
    }

    public synchronized List<Member> members() {
        return new ArrayList<>(members.values());
    }

    public synchronized PlaybackState state() {
        return state;
    }

    public synchronized Member join(String sessionId, String name) {
        Member m = new Member(sessionId, name);
        members.put(sessionId, m);
        touch();
        return m;
    }

    public synchronized Member leave(String sessionId) {
        touch();
        return members.remove(sessionId);
    }

    public synchronized Member member(String sessionId) {
        return members.get(sessionId);
    }

    public synchronized ChatMessage addChat(String type, String user, String text) {
        String clean = text == null ? "" : text.strip();
        if (clean.isEmpty()) {
            return null;
        }
        if (clean.length() > MAX_CHAT_LENGTH) {
            clean = clean.substring(0, MAX_CHAT_LENGTH);
        }
        ChatMessage msg = new ChatMessage(UUID.randomUUID().toString(), type, user, clean,
                System.currentTimeMillis());
        chat.addLast(msg);
        while (chat.size() > MAX_CHAT_HISTORY) {
            chat.removeFirst();
        }
        touch();
        return msg;
    }

    /** Áp dụng lệnh điều khiển (play/pause/seek/load) và trả về trạng thái mới. */
    public synchronized PlaybackState control(Requests.Control req, long now) {
        if (req == null || req.action() == null) {
            throw new IllegalArgumentException("Thiếu action");
        }
        double pos = req.position() != null && Double.isFinite(req.position())
                ? Math.max(0, req.position())
                : state.positionAt(now);

        state = switch (req.action()) {
            case "play" -> new PlaybackState(requireSource(), true, pos, now);
            case "pause" -> new PlaybackState(requireSource(), false, pos, now);
            case "seek" -> new PlaybackState(requireSource(), state.playing(), pos, now);
            case "load" -> new PlaybackState(validate(req.source()), true, 0, now);
            default -> throw new IllegalArgumentException("Action không hợp lệ: " + req.action());
        };
        touch();
        return state;
    }

    public synchronized RoomSnapshot snapshot(String you, long now) {
        return new RoomSnapshot(id, you, state, new ArrayList<>(chat), new ArrayList<>(members.values()), now);
    }

    private VideoSource requireSource() {
        if (state.source() == null) {
            throw new IllegalArgumentException("Phòng chưa chọn video");
        }
        return state.source();
    }

    private static VideoSource validate(VideoSource s) {
        if (s == null || s.type() == null || s.url() == null) {
            throw new IllegalArgumentException("Thiếu nguồn video");
        }
        String url = s.url().strip();
        switch (s.type()) {
            case "youtube" -> {
                if (!YOUTUBE_ID.matcher(url).matches()) {
                    throw new IllegalArgumentException("Video YouTube không hợp lệ");
                }
            }
            case "video" -> {
                if (!(url.startsWith("https://") || url.startsWith("http://") || url.startsWith("/api/"))) {
                    throw new IllegalArgumentException("Link video phải bắt đầu bằng http(s):// hoặc /api/");
                }
            }
            default -> throw new IllegalArgumentException("Loại nguồn không hỗ trợ: " + s.type());
        }
        String title = s.title() == null || s.title().isBlank() ? url : s.title().strip();
        if (title.length() > MAX_TITLE_LENGTH) {
            title = title.substring(0, MAX_TITLE_LENGTH);
        }
        return new VideoSource(s.type(), url, title);
    }

    private void touch() {
        lastActive = System.currentTimeMillis();
    }
}
