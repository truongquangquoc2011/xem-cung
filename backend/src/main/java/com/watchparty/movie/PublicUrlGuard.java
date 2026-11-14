package com.watchparty.movie;

import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;

/**
 * Chống SSRF: chỉ cho phép server gọi ra URL http(s) công khai.
 *
 * Kiểm tra theo IP thật sau khi phân giải DNS (không chỉ so chuỗi tên miền), nên chặn được cả
 * 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x (metadata cloud), ::1, fc00::/7, fe80::/10,
 * và tên miền trỏ về mạng nội bộ.
 */
public final class PublicUrlGuard {

    private PublicUrlGuard() {
    }

    public static URI requirePublicHttpUrl(String raw) {
        URI uri;
        try {
            uri = URI.create(raw);
        } catch (Exception e) {
            throw new IllegalArgumentException("URL không hợp lệ");
        }
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http"))) {
            throw new IllegalArgumentException("Chỉ hỗ trợ http/https");
        }
        if (uri.getUserInfo() != null) {
            throw new IllegalArgumentException("URL không hợp lệ");
        }
        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException("URL thiếu host");
        }
        int port = uri.getPort();
        if (port != -1 && port != 80 && port != 443) {
            throw new IllegalArgumentException("Cổng không được phép");
        }
        InetAddress[] addresses;
        try {
            addresses = InetAddress.getAllByName(host);
        } catch (UnknownHostException e) {
            throw new IllegalArgumentException("Không phân giải được host");
        }
        for (InetAddress a : addresses) {
            if (isInternal(a)) {
                throw new IllegalArgumentException("Host không được phép");
            }
        }
        return uri;
    }

    static boolean isInternal(InetAddress a) {
        if (a.isAnyLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress()
                || a.isSiteLocalAddress() || a.isMulticastAddress()) {
            return true;
        }
        byte[] b = a.getAddress();
        if (a instanceof Inet6Address) {
            // fc00::/7 (unique local)
            return (b[0] & 0xFE) == 0xFC;
        }
        int first = b[0] & 0xFF;
        int second = b[1] & 0xFF;
        // 100.64.0.0/10 (carrier-grade NAT) và 0.0.0.0/8
        return first == 0 || (first == 100 && second >= 64 && second <= 127);
    }
}
