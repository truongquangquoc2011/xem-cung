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

    public record RoomSummary(String id, String title, int memberCount, boolean hasPin,
                              boolean pinned, String playingTitle) {
    }

    private final String id;
    private final String title;
    private final String pin;
    private final boolean pinned;
    private final Map<String, Member> members = new LinkedHashMap<>();
    private final Deque<ChatMessage> chat = new ArrayDeque<>();
    private PlaybackState state;
    private volatile long lastActive;

    public Room(String id) {
        this(id, "Phòng " + id, null, false);
    }

    public Room(String id, String title, String pin, boolean pinned) {
        this.id = id;
        String cleanTitle = title == null ? "" : title.strip();
        this.title = cleanTitle.isEmpty() ? ("Phòng " + id) : cleanTitle;
        String cleanPin = pin == null ? "" : pin.strip();
        this.pin = cleanPin.isEmpty() ? null : cleanPin;
        this.pinned = pinned;
        long now = System.currentTimeMillis();
        this.state = new PlaybackState(null, false, 0, now);
        this.lastActive = now;
    }

    public String getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public boolean hasPin() {
        return pin != null && !pin.isEmpty();
    }

    public boolean isPinned() {
        return pinned;
    }

    public boolean checkPin(String candidate) {
        if (!hasPin()) {
            return true;
        }
        // So sánh thời gian hằng số: không lộ PIN qua thời gian phản hồi
        byte[] expected = pin.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] actual = (candidate == null ? "" : candidate.strip()).getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return java.security.MessageDigest.isEqual(expected, actual);
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

    public synchronized RoomSummary summary() {
        // Phòng khoá PIN: không lộ tên phim đang chiếu ra sảnh công khai
        String playingTitle = !hasPin() && state != null && state.source() != null ? state.source().title() : null;
        return new RoomSummary(id, title, members.size(), hasPin(), pinned, playingTitle);
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

    public synchronized Member updateVoiceState(String sessionId, boolean inVoice, boolean muted, boolean deafened) {
        Member current = members.get(sessionId);
        if (current == null) {
            return null;
        }
        Member updated = new Member(current.id(), current.name(), inVoice, muted, deafened);
        members.put(sessionId, updated);
        touch();
        return updated;
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
        return new RoomSnapshot(id, title, hasPin(), you, state, new ArrayList<>(chat),
                new ArrayList<>(members.values()), now);
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
