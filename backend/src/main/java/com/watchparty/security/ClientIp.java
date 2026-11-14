package com.watchparty.security;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Lấy IP client làm khoá giới hạn tần suất.
 * Dùng request.getRemoteAddr(): khi chạy sau proxy (Render, Cloudflare), Spring đã tự thay bằng IP thật
 * nhờ server.forward-headers-strategy=native, nên không tự đọc X-Forwarded-For (client có thể giả mạo).
 */
public final class ClientIp {

    public static final String SESSION_ATTR = "clientIp";

    private ClientIp() {
    }

    public static String of(HttpServletRequest request) {
        String ip = request == null ? null : request.getRemoteAddr();
        return ip == null || ip.isBlank() ? "unknown" : ip;
    }
}
