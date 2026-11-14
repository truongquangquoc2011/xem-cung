package com.watchparty.security;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Giới hạn tần suất kiểu "cửa sổ trượt": tối đa {@code maxEvents} lần trong {@code windowMs} cho mỗi khoá.
 * Nhẹ, chạy trong RAM, đủ dùng cho 1 instance (phòng cũng đang lưu trong RAM).
 */
public class RateLimiter {

    private final int maxEvents;
    private final long windowMs;
    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    public RateLimiter(int maxEvents, long windowMs) {
        this.maxEvents = maxEvents;
        this.windowMs = windowMs;
    }

    /** Ghi nhận 1 lần và trả về true nếu còn trong hạn mức. */
    public boolean tryAcquire(String key) {
        long now = System.currentTimeMillis();
        Deque<Long> q = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (q) {
            evict(q, now);
            if (q.size() >= maxEvents) {
                return false;
            }
            q.addLast(now);
            return true;
        }
    }

    /** Chỉ kiểm tra, không ghi nhận (dùng cho "đã sai quá nhiều lần chưa"). */
    public boolean isBlocked(String key) {
        Deque<Long> q = hits.get(key);
        if (q == null) {
            return false;
        }
        synchronized (q) {
            evict(q, System.currentTimeMillis());
            return q.size() >= maxEvents;
        }
    }

    /** Ghi nhận 1 lần mà không chặn (dùng để đếm số lần nhập sai). */
    public void record(String key) {
        long now = System.currentTimeMillis();
        Deque<Long> q = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (q) {
            evict(q, now);
            q.addLast(now);
        }
    }

    public void reset(String key) {
        hits.remove(key);
    }

    /** Dọn các khoá đã hết hạn để map không phình mãi. */
    public void cleanup() {
        long now = System.currentTimeMillis();
        hits.entrySet().removeIf(e -> {
            Deque<Long> q = e.getValue();
            synchronized (q) {
                evict(q, now);
                return q.isEmpty();
            }
        });
    }

    private void evict(Deque<Long> q, long now) {
        while (!q.isEmpty() && now - q.peekFirst() > windowMs) {
            q.removeFirst();
        }
    }
}
