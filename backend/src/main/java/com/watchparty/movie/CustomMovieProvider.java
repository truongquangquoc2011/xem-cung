package com.watchparty.movie;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
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
 * Nguồn phim tùy chỉnh hỗ trợ Nguồn C (https://phim.nguonc.com/api) và VSMOV (https://vsmov.com/api).
 *
 * Bật bằng application.yml:
 * <pre>
 * movies:
 *   provider: custom
 *   custom:
 *     base-url: https://phim.nguonc.com/api
 * </pre>
 */
@Component
@ConditionalOnProperty(name = "movies.provider", havingValue = "custom")
public class CustomMovieProvider implements MovieProvider {

    private static final Pattern SAFE_SLUG = Pattern.compile("[A-Za-z0-9._-]+");
    private static final Pattern HTML_TAG = Pattern.compile("<[^>]+>");
    private static final Set<String> LIST_SLUGS = Set.of("phim-le", "phim-bo", "hoat-hinh", "tv-shows", "phim-dang-chieu");
    private static final Set<String> COUNTRY_SLUGS = Set.of("han-quoc", "trung-quoc", "nhat-ban", "au-my", "thai-lan", "viet-nam", "dai-loan", "hong-kong");
    /** Nhận diện link embed Nguồn C dạng https://embed1.streamc.xyz/embed.php?hash={hash} */
    private static final Pattern NGUONC_EMBED = Pattern.compile("^https?://([A-Za-z0-9.-]+\\.streamc\\.xyz)/embed\\.php\\?hash=([A-Za-z0-9-]+).*$");
    /** Nhận diện link_embed VSMOV dạng https://v6.streamvsmov.com/video/{hash} */
    private static final Pattern VSMOV_EMBED = Pattern.compile("^https?://([A-Za-z0-9.-]+\\.streamvsmov\\.com)/video/([A-Za-z0-9-]+)$");

    private final RestClient http;
    private final boolean isNguonC;

    public CustomMovieProvider(@Value("${movies.custom.base-url}") String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("Chưa điền movies.custom.base-url trong application.yml");
        }
        String cleanBase = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.isNguonC = cleanBase.contains("nguonc.com");
        this.http = RestClient.builder()
                .baseUrl(cleanBase)
                .defaultHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
                .build();
    }

    @Override
    public MoviePage search(String query, int page) {
        return search(query, "", "", page);
    }

    @Override
    public MoviePage search(String query, String category, String period, int page) {
        int p = Math.max(1, page);
        String q = query == null ? "" : query.strip();
        String cat = category == null ? "" : category.strip().toLowerCase();
        String per = period == null ? "" : period.strip().toLowerCase();

        // Chế độ Hot theo thời gian (today / week / month) khi chưa nhập từ khoá tìm kiếm
        if (q.isEmpty() && cat.isEmpty() && !per.isEmpty()) {
            int offsetPage = switch (per) {
                case "today" -> p;
                case "week" -> p + 1;
                case "month" -> p + 2;
                default -> p;
            };
            p = offsetPage;
        }

        final int targetPage = p;
        JsonNode root;
        if (isNguonC) {
            if (!q.isEmpty()) {
                root = http.get()
                        .uri(b -> b.path("/films/search")
                                .queryParam("keyword", q)
                                .queryParam("page", targetPage)
                                .build())
                        .retrieve()
                        .body(JsonNode.class);
            } else {
                String path = resolveNguonCPath(cat);
                root = http.get()
                        .uri(b -> b.path(path).queryParam("page", targetPage).build())
                        .retrieve()
                        .body(JsonNode.class);
            }
        } else {
            if (!q.isEmpty()) {
                root = http.get()
                        .uri(b -> b.path("/tim-kiem")
                                .queryParam("keyword", q)
                                .queryParam("page", targetPage)
                                .queryParam("limit", 24)
                                .build())
                        .retrieve()
                        .body(JsonNode.class);
            } else {
                String path = resolveVsmovPath(cat);
                root = http.get()
                        .uri(b -> b.path(path).queryParam("page", targetPage).build())
                        .retrieve()
                        .body(JsonNode.class);
            }
        }

        if (root == null) {
            return new MoviePage(List.of(), targetPage, 1);
        }

        String pathImage = text(root.path("pathImage"));
        List<MovieSummary> items = new ArrayList<>();
        for (JsonNode item : root.path("items")) {
            String slug = text(item.path("slug"));
            if (slug.isEmpty()) {
                continue;
            }
            // Bỏ qua các mục chỉ mới có Trailer trên danh sách nếu rõ ràng ghi "Trailer"
            String currentEp = text(item.path("current_episode"));
            if ("Trailer".equalsIgnoreCase(currentEp)) {
                continue;
            }
            String title = text(item.path("name"));
            String year = extractYear(item);
            String poster = resolveImage(item, pathImage);
            String backdrop = resolveBackdrop(item, pathImage, poster);
            String quality = text(item.path("quality"));
            String lang = text(item.path("language"));
            String badge = !quality.isEmpty() && !lang.isEmpty() ? (quality + " · " + lang) : (!quality.isEmpty() ? quality : lang);
            items.add(new MovieSummary(slug, title, year, poster, currentEp, badge, backdrop));
        }

        // Nếu chọn "month" (Hot tháng), ưu tiên các phim phát hành năm mới nhất lên đầu
        if ("month".equals(per) && q.isEmpty()) {
            items.sort((a, b) -> b.year().compareTo(a.year()));
        } else if ("week".equals(per) && q.isEmpty()) {
            // Đảo nhẹ thứ tự các phim nhiều tập / hoàn tất lên đầu cho bảng Hot tuần
            items.sort((a, b) -> Boolean.compare(
                    b.currentEpisode().toLowerCase().contains("hoàn tất") || b.currentEpisode().toLowerCase().contains("full"),
                    a.currentEpisode().toLowerCase().contains("hoàn tất") || a.currentEpisode().toLowerCase().contains("full")
            ));
        }

        if (isNguonC) {
            JsonNode paginate = root.path("paginate");
            int currentPage = paginate.path("current_page").asInt(targetPage);
            int totalPages = Math.max(1, paginate.path("total_page").asInt(1));
            return new MoviePage(items, currentPage, totalPages);
        } else {
            JsonNode pagination = root.path("pagination");
            int currentPage = pagination.path("currentPage").asInt(targetPage);
            int totalPages = Math.max(1, pagination.path("totalPages").asInt(1));
            return new MoviePage(items, currentPage, totalPages);
        }
    }

    private static String resolveNguonCPath(String cat) {
        if (cat.isEmpty() || "all".equals(cat) || !SAFE_SLUG.matcher(cat).matches()) {
            return "/films/phim-moi-cap-nhat";
        }
        if (LIST_SLUGS.contains(cat)) {
            return "/films/danh-sach/" + cat;
        }
        if (COUNTRY_SLUGS.contains(cat)) {
            return "/films/quoc-gia/" + cat;
        }
        return "/films/the-loai/" + cat;
    }

    private static String resolveVsmovPath(String cat) {
        if (cat.isEmpty() || "all".equals(cat) || !SAFE_SLUG.matcher(cat).matches()) {
            return "/danh-sach/phim-moi-cap-nhat";
        }
        if (LIST_SLUGS.contains(cat)) {
            return "/danh-sach/" + cat;
        }
        if (COUNTRY_SLUGS.contains(cat)) {
            return "/quoc-gia/" + cat;
        }
        return "/the-loai/" + cat;
    }

    @Override
    public MovieDetail detail(String id) {
        if (id == null || !SAFE_SLUG.matcher(id).matches()) {
            throw new IllegalArgumentException("Mã phim (slug) không hợp lệ");
        }

        JsonNode root = http.get()
                .uri(isNguonC ? "/film/{slug}" : "/phim/{slug}", id)
                .retrieve()
                .body(JsonNode.class);

        if (root == null) {
            throw new IllegalArgumentException("Không tìm thấy phim");
        }
        String statusText = text(root.path("status"));
        boolean okStatus = root.path("status").asBoolean(false) || "success".equalsIgnoreCase(statusText);
        if (!okStatus) {
            throw new IllegalArgumentException("Không tìm thấy phim");
        }

        JsonNode movie = root.path("movie");
        if (movie.isMissingNode() || movie.isEmpty()) {
            throw new IllegalArgumentException("Không tìm thấy thông tin phim");
        }

        String title = text(movie.path("name"));
        String originalTitle = text(movie.path("original_name"));
        if (originalTitle.isEmpty()) {
            originalTitle = text(movie.path("origin_name"));
        }
        String rawDesc = !text(movie.path("description")).isEmpty()
                ? text(movie.path("description"))
                : text(movie.path("content"));
        String description = HTML_TAG.matcher(rawDesc).replaceAll("").strip();
        String year = extractYear(movie);
        String poster = resolveImage(movie, text(root.path("pathImage")));

        JsonNode servers = movie.path("episodes").isArray() ? movie.path("episodes") : root.path("episodes");
        int serverCount = servers.isArray() ? servers.size() : 0;

        List<Episode> episodes = new ArrayList<>();
        for (JsonNode server : servers) {
            String serverName = text(server.path("server_name")).replaceAll("\\s+", " ").strip();
            JsonNode epList = server.path("items").isArray() ? server.path("items") : server.path("server_data");
            for (JsonNode ep : epList) {
                String epName = text(ep.path("name")).strip();
                String linkM3u8 = text(ep.path("m3u8")).strip();
                if (linkM3u8.isEmpty()) {
                    linkM3u8 = text(ep.path("link_m3u8")).strip();
                }
                String linkEmbed = text(ep.path("embed")).strip();
                if (linkEmbed.isEmpty()) {
                    linkEmbed = text(ep.path("link_embed")).strip();
                }

                String playUrl = !linkM3u8.isEmpty() ? linkM3u8 : toStreamUrl(linkEmbed);
                if (playUrl.isEmpty()) {
                    continue;
                }

                String label = formatEpisodeLabel(epName, serverName, serverCount > 1);
                episodes.add(new Episode(label, playUrl));
            }
        }

        return new MovieDetail(id, title, originalTitle, description, year, poster, episodes);
    }

    /**
     * Chuyển link embed của Nguồn C (https://embed*.streamc.xyz/embed.php?hash={hash})
     * hoặc VSMOV (https://v*.streamvsmov.com/video/{hash})
     * thành link proxy HLS qua backend (/api/movies/hls/{host}/{hash}/master.m3u8)
     * để trình phát HTML5 + hls.js phát trực tiếp không bị chặn CORS và đồng bộ cho cả phòng.
     */
    private static String toStreamUrl(String linkEmbed) {
        if (linkEmbed == null || linkEmbed.isEmpty()) {
            return "";
        }
        Matcher nc = NGUONC_EMBED.matcher(linkEmbed);
        if (nc.matches()) {
            return "/api/movies/hls/" + nc.group(1) + "/" + nc.group(2) + "/master.m3u8";
        }
        Matcher vs = VSMOV_EMBED.matcher(linkEmbed);
        if (vs.matches()) {
            return "/api/movies/hls/" + vs.group(1) + "/" + vs.group(2) + "/master.m3u8";
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

    private static String extractYear(JsonNode item) {
        String y = text(item.path("year"));
        if (!y.isEmpty() && !"0".equals(y)) {
            return y;
        }
        // Nguồn C đôi khi để năm trong category["3"].list[0].name hoặc created
        JsonNode cat3List = item.path("category").path("3").path("list");
        if (cat3List.isArray() && !cat3List.isEmpty()) {
            String catYear = text(cat3List.get(0).path("name"));
            if (!catYear.isEmpty()) {
                return catYear;
            }
        }
        String created = text(item.path("created"));
        if (created.length() >= 4 && created.substring(0, 4).matches("\\d{4}")) {
            return created.substring(0, 4);
        }
        return "";
    }

    private static String resolveBackdrop(JsonNode item, String pathImage, String fallback) {
        String posterUrl = text(item.path("poster_url"));
        if (posterUrl.isEmpty()) {
            return fallback;
        }
        if (posterUrl.startsWith("http://") || posterUrl.startsWith("https://")) {
            return posterUrl;
        }
        if (!pathImage.isEmpty()) {
            String prefix = pathImage.endsWith("/") ? pathImage : pathImage + "/";
            String cleanPath = posterUrl.startsWith("/") ? posterUrl.substring(1) : posterUrl;
            return prefix + cleanPath;
        }
        return fallback;
    }

    /**
     * Lấy ảnh từ poster_url hoặc thumb_url. Hỗ trợ cả ảnh WebP chất lượng cao của Nguồn C.
     */
    private static String resolveImage(JsonNode item, String pathImage) {
        String thumb = text(item.path("thumb_url"));
        String poster = text(item.path("poster_url"));
        // Trên Nguồn C, thumb_url là poster dọc chuẩn tỉ lệ 2:3, còn poster_url là ảnh ngang backdrop
        String chosen = !thumb.isEmpty() ? thumb : poster;
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
