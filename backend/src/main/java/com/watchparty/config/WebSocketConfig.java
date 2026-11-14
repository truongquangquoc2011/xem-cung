package com.watchparty.config;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.server.HandshakeInterceptor;

import com.watchparty.security.ClientIp;
import com.watchparty.security.StompSecurityInterceptor;

/**
 * STOMP over WebSocket.
 * <ul>
 *   <li>Client kết nối: ws://host/ws</li>
 *   <li>Client gửi lên: /app/room/{id}/join | control | chat</li>
 *   <li>Server phát cho cả phòng: /topic/room/{id}</li>
 *   <li>Server gửi riêng cho 1 người: /user/queue/snapshot, /user/queue/errors</li>
 * </ul>
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Value("${app.allowed-origins:*}")
    private String[] allowedOrigins;

    private final StompSecurityInterceptor securityInterceptor;

    public WebSocketConfig(StompSecurityInterceptor securityInterceptor) {
        this.securityInterceptor = securityInterceptor;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns(allowedOrigins)
                .addInterceptors(new ClientIpHandshakeInterceptor());
        // Xử lý tin nhắn của từng client đúng thứ tự gửi (subscribe -> join -> control...)
        registry.setPreserveReceiveOrder(true);
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
        registry.setPreservePublishOrder(true);
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(securityInterceptor);
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        // Tin nhắn lớn nhất ~ SDP của WebRTC; chặn client gửi khối dữ liệu khổng lồ
        registration.setMessageSizeLimit(64 * 1024);
        registration.setSendBufferSizeLimit(512 * 1024);
        registration.setSendTimeLimit(15_000);
    }

    /** Lưu IP client vào session WebSocket để giới hạn đoán PIN theo IP. */
    private static final class ClientIpHandshakeInterceptor implements HandshakeInterceptor {
        @Override
        public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                       WebSocketHandler wsHandler, Map<String, Object> attributes) {
            if (request instanceof ServletServerHttpRequest servlet) {
                attributes.put(ClientIp.SESSION_ATTR, ClientIp.of(servlet.getServletRequest()));
            }
            return true;
        }

        @Override
        public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Exception exception) {
        }
    }
}
