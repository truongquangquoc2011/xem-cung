package com.watchparty.config;

import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Value("${app.allowed-origins:*}")
    private String[] allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(allowedOrigins)
                .allowedMethods("GET", "POST", "OPTIONS")
                .maxAge(3600);
    }

    /**
     * Khi đóng gói chung frontend vào static/ của Spring Boot,
     * chuyển các route SPA (vd: /room/ABC123) về index.html để F5 không bị 404.
     */
    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/room/{id}").setViewName("forward:/index.html");
        registry.addViewController("/xem/{id}").setViewName("forward:/index.html");
    }

    /**
     * Cache file tĩnh:
     * <ul>
     *   <li>/assets/** (JS/CSS có hash trong tên, đổi nội dung là đổi tên) -> cache 1 năm, immutable.</li>
     *   <li>Còn lại (index.html...) -> no-cache: trình duyệt luôn hỏi lại server nên deploy xong thấy bản mới ngay.</li>
     * </ul>
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/assets/**")
                .addResourceLocations("classpath:/static/assets/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable());
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .setCacheControl(CacheControl.noCache());
    }
}
