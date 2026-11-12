package com.watchparty.movie;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import com.fasterxml.jackson.databind.JsonNode;
import com.watchparty.movie.MovieModels.Episode;
import com.watchparty.movie.MovieModels.MovieDetail;
import com.watchparty.movie.MovieModels.MoviePage;
import com.watchparty.movie.MovieModels.MovieSummary;

/**
 * Nguồn phim VSMOV API (https://vsmov.com/api).
 *
 * Bật bằng application.yml:
 * <pre>
 * movies:
 *   provider: custom
 *   custom:
 *     base-url: https://vsmov.com/api
 * </pre>
 */
@Component
@ConditionalOnProperty(name = "movies.provider", havingValue = "custom")
public class CustomMovieProvider implements MovieProvider {

    private static final Pattern SAFE_SLUG = Pattern.compile("[A-Za-z0-9._-]+");
    private static final Pattern HTML_TAG = Pattern.compile("<[^>]+>");
    /** Nhận diện link_embed dạng https://v6.streamvsmov.com/video/{hash} */
    private static final Pattern STREAM_EMBED = Pattern.compile("^(https?://([A-Za-z0-9.-]+))/video/([A-Za-z0-9-]+)$");

    private final RestClient http;

    public CustomMovieProvider(@Value("${movies.custom.base-url}") String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("Chưa điền movies.custom.base-url trong application.yml");
        }
        String cleanBase = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.http = RestClient.builder()
                .baseUrl(cleanBase)
                .defaultHeader("User-Agent", "watch-party/1.0")
                .build();
    }

    @Override
    public MoviePage search(String query, int page) {
        int p = Math.max(1, page);
        String q = query == null ? "" : query.strip();

        JsonNode root;
        if (q.isEmpty()) {
            root = http.get()
                    .uri(b -> b.path("/danh-sach/phim-moi-cap-nhat").queryParam("page", p).build())
                    .retrieve()
                    .body(JsonNode.class);
        } else {
            root = http.get()
                    .uri(b -> b.path("/tim-kiem")
                            .queryParam("keyword", q)
                            .queryParam("page", p)
                            .queryParam("limit", 24)
                            .build())
                    .retrieve()
                    .body(JsonNode.class);
        }

        if (root == null) {
            return new MoviePage(List.of(), p, 1);
        }

        String pathImage = text(root.path("pathImage"));
        List<MovieSummary> items = new ArrayList<>();
        for (JsonNode item : root.path("items")) {
            String slug = text(item.path("slug"));
            if (slug.isEmpty()) {
                continue;
            }
            String title = text(item.path("name"));
            String year = text(item.path("year"));
            String poster = resolveImage(item, pathImage);
            items.add(new MovieSummary(slug, title, year, poster));
        }

        JsonNode pagination = root.path("pagination");
        int currentPage = pagination.path("currentPage").asInt(p);
        int totalPages = Math.max(1, pagination.path("totalPages").asInt(1));
        return new MoviePage(items, currentPage, totalPages);
    }

    @Override
    public MovieDetail detail(String id) {
        if (id == null || !SAFE_SLUG.matcher(id).matches()) {
            throw new IllegalArgumentException("Mã phim (slug) không hợp lệ");
        }

        JsonNode root = http.get()
                .uri("/phim/{slug}", id)
                .retrieve()
                .body(JsonNode.class);

        if (root == null || !root.path("status").asBoolean(false)) {
            throw new IllegalArgumentException("Không tìm thấy phim");
        }

        JsonNode movie = root.path("movie");
        if (movie.isMissingNode() || movie.isEmpty()) {
            throw new IllegalArgumentException("Không tìm thấy thông tin phim");
        }

        String title = text(movie.path("name"));
        String rawContent = text(movie.path("content"));
        String description = HTML_TAG.matcher(rawContent).replaceAll("").strip();
        String year = text(movie.path("year"));
        String poster = resolveImage(movie, text(root.path("pathImage")));

        JsonNode servers = root.path("episodes");
        int serverCount = servers.isArray() ? servers.size() : 0;

        List<Episode> episodes = new ArrayList<>();
        for (JsonNode server : servers) {
            String serverName = text(server.path("server_name")).replaceAll("\\s+", " ").strip();
            for (JsonNode ep : server.path("server_data")) {
                String epName = text(ep.path("name")).strip();
                String linkM3u8 = text(ep.path("link_m3u8")).strip();
                String linkEmbed = text(ep.path("link_embed")).strip();

                String playUrl = !linkM3u8.isEmpty() ? linkM3u8 : toStreamUrl(linkEmbed);
                if (playUrl.isEmpty()) {
                    continue;
                }

                String label = formatEpisodeLabel(epName, serverName, serverCount > 1);
                episodes.add(new Episode(label, playUrl));
            }
        }

        return new MovieDetail(id, title, description, year, poster, episodes);
    }

    /**
     * Chuyển link_embed của VSMOV (vd: https://v10.streamvsmov.com/video/{hash})
     * thành link proxy HLS qua backend (/api/movies/hls/{host}/{hash}/master.m3u8)
     * để trình phát HTML5 + hls.js phát trực tiếp không bị chặn CORS và đồng bộ cho cả phòng.
     */
    private static String toStreamUrl(String linkEmbed) {
        if (linkEmbed == null || linkEmbed.isEmpty()) {
            return "";
        }
        Matcher m = STREAM_EMBED.matcher(linkEmbed);
        if (m.matches()) {
            return "/api/movies/hls/" + m.group(2) + "/" + m.group(3) + "/master.m3u8";
        }
        if (linkEmbed.contains(".m3u8") || linkEmbed.contains(".mp4")) {
            return linkEmbed;
        }
        return "";
    }

    private static String formatEpisodeLabel(String epName, String serverName, boolean multiServer) {
        String base;
        if (epName.isEmpty() || "Full".equalsIgnoreCase(epName)) {
            base = "Full";
        } else if (epName.matches("\\d+")) {
            base = "Tập " + epName;
        } else {
            base = epName;
        }
        if (multiServer && !serverName.isEmpty()) {
            return base + " (" + serverName + ")";
        }
        return base;
    }

    /**
     * Lấy ảnh từ poster_url hoặc thumb_url. Một số phim trên VSMOV trả poster_url: {} (object rỗng),
     * nên chỉ lấy khi node là text hợp lệ.
     */
    private static String resolveImage(JsonNode item, String pathImage) {
        String poster = text(item.path("poster_url"));
        String thumb = text(item.path("thumb_url"));
        String chosen = !poster.isEmpty() ? poster : thumb;
        if (chosen.isEmpty()) {
            return "";
        }
        if (chosen.startsWith("http://") || chosen.startsWith("https://")) {
            return chosen;
        }
        if (!pathImage.isEmpty()) {
            String prefix = pathImage.endsWith("/") ? pathImage : pathImage + "/";
            String cleanPath = chosen.startsWith("/") ? chosen.substring(1) : chosen;
            return prefix + cleanPath;
        }
        return "https://vsmov.com/storage/images/" + (chosen.startsWith("/") ? chosen.substring(1) : chosen);
    }

    private static String text(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull() || node.isObject() || node.isArray()) {
            return "";
        }
        return node.asText("").strip();
    }
}
