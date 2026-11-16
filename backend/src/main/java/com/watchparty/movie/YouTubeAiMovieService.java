package com.watchparty.movie;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.watchparty.movie.MovieModels.Episode;
import com.watchparty.movie.MovieModels.MovieDetail;
import com.watchparty.movie.MovieModels.MovieSummary;

/**
 * Tìm kiếm và cung cấp danh sách Phim AI từ YouTube (không cần API key).
 * Trả về MovieSummary/MovieDetail tương thích hoàn toàn với Kho phim & YouTubePlayer.
 */
@Service
public class YouTubeAiMovieService {

    private static final Logger log = LoggerFactory.getLogger(YouTubeAiMovieService.class);
    private static final Pattern SAFE_VIDEO_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");
    private static final Pattern AI_TOPIC_KEYWORDS = Pattern.compile(
            "(?iu)(phim\\s*ai|\\bai\\b|3d|tu\\s*tiên|tiên\\s*hiệp|xuyên\\s*không|trùng\\s*sinh|hệ\\s*thống|mạt\\s*thế|huyền\\s*huyễn|cổ\\s*đại|đại\\s*tống|mễ\\s*lạc)");
    private static final long CACHE_TTL_MS = Duration.ofMinutes(30).toMillis();
    private static final List<String> DEFAULT_AI_QUERIES = List.of(
            "Mễ Lạc Review phim AI",
            "phim hoạt hình AI 3D tu tiên xuyên không full"
    );

    private record CachedList(List<MovieSummary> items, long expiresAt) {
    }

    private final RestClient http;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, CachedList> searchCache = new ConcurrentHashMap<>();
    private final Map<String, MovieSummary> summaryCache = new ConcurrentHashMap<>();

    public YouTubeAiMovieService() {
        var client = java.net.http.HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(8))
                .followRedirects(java.net.http.HttpClient.Redirect.NORMAL)
                .build();
        var factory = new JdkClientHttpRequestFactory(client);
        factory.setReadTimeout(Duration.ofSeconds(12));
        this.http = RestClient.builder()
                .requestFactory(factory)
                .defaultHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
                .defaultHeader("Accept-Language", "vi-VN,vi;q=0.9,en;q=0.8")
                .build();
    }

    public boolean isYouTubeMovieId(String id) {
        return id != null && id.startsWith("yt-") && SAFE_VIDEO_ID.matcher(id.substring(3)).matches();
    }

    /** Danh sách Phim AI mặc định từ các kênh/từ khóa YouTube phổ biến (có lọc đúng chủ đề AI/Tiên hiệp/Xuyên không). */
    public List<MovieSummary> listDefaultAiMovies() {
        Map<String, MovieSummary> merged = new LinkedHashMap<>();
        for (String q : DEFAULT_AI_QUERIES) {
            for (MovieSummary item : search(q, 14)) {
                String haystack = item.title() + " " + item.quality();
                if (AI_TOPIC_KEYWORDS.matcher(haystack).find()) {
                    merged.putIfAbsent(item.id(), item);
                }
            }
        }
        return new ArrayList<>(merged.values());
    }

    /** Tìm kiếm video YouTube theo từ khóa, trả về danh sách MovieSummary. */
    public List<MovieSummary> search(String query, int limit) {
        if (query == null || query.isBlank()) return List.of();
        String key = query.strip().toLowerCase() + "|" + limit;
        long now = System.currentTimeMillis();
        CachedList cached = searchCache.get(key);
        if (cached != null && cached.expiresAt() > now) {
            return cached.items();
        }

        List<MovieSummary> results = fetchYouTubeSearch(query.strip(), limit);
        if (results.isEmpty()) {
            results = fetchBingYouTubeSearch(query.strip(), limit);
        }
        if (!results.isEmpty()) {
            searchCache.put(key, new CachedList(results, now + CACHE_TTL_MS));
        }
        return results;
    }

    /** Lấy chi tiết 1 phim YouTube (id dạng yt-{videoId}) để phát bằng YouTubePlayer đồng bộ. */
    public MovieDetail detail(String id) {
        if (!isYouTubeMovieId(id)) {
            throw new IllegalArgumentException("Mã video YouTube không hợp lệ: " + id);
        }
        String videoId = id.substring(3);
        String watchUrl = "https://www.youtube.com/watch?v=" + videoId;
        String poster = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";

        MovieSummary cached = summaryCache.get(id);
        String title = cached != null ? cached.title() : "";
        String channel = cached != null ? cached.quality() : "";
        String duration = cached != null ? cached.currentEpisode() : "";

        if (title.isEmpty()) {
            try {
                String oembedUrl = "https://www.youtube.com/oembed?url="
                        + URLEncoder.encode(watchUrl, StandardCharsets.UTF_8)
                        + "&format=json";
                JsonNode meta = http.get().uri(URI.create(oembedUrl)).retrieve().body(JsonNode.class);
                if (meta != null) {
                    title = meta.path("title").asText("").strip();
                    channel = meta.path("author_name").asText("").strip();
                }
            } catch (Exception e) {
                log.debug("YouTube oEmbed lỗi cho {}: {}", videoId, e.getMessage());
            }
        }

        if (title.isEmpty()) title = "Phim AI trên YouTube (" + videoId + ")";
        String desc = channel.isEmpty()
                ? "Phát trực tiếp từ YouTube đồng bộ trong phòng."
                : "Kênh: " + channel + (duration.isEmpty() ? "" : " · Thời lượng: " + duration);

        return new MovieDetail(
                id,
                title,
                "",
                desc,
                "YouTube",
                poster,
                List.of(new Episode("Full", watchUrl))
        );
    }

    private List<MovieSummary> fetchYouTubeSearch(String query, int limit) {
        try {
            String url = "https://www.youtube.com/results?search_query="
                    + URLEncoder.encode(query, StandardCharsets.UTF_8);
            String html = http.get()
                    .uri(URI.create(url))
                    .header("Cookie", "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg")
                    .retrieve()
                    .body(String.class);
            if (html == null || html.isEmpty()) return List.of();

            String marker = "var ytInitialData = ";
            int start = html.indexOf(marker);
            if (start < 0) return List.of();
            start += marker.length();
            int end = html.indexOf(";</script>", start);
            if (end < 0) return List.of();

            String jsonText = html.substring(start, end);
            JsonNode root = mapper.readTree(jsonText);
            JsonNode sections = root.path("contents")
                    .path("twoColumnSearchResultsRenderer")
                    .path("primaryContents")
                    .path("sectionListRenderer")
                    .path("contents");
            if (!sections.isArray()) return List.of();

            List<MovieSummary> out = new ArrayList<>();
            for (JsonNode section : sections) {
                JsonNode items = section.path("itemSectionRenderer").path("contents");
                if (!items.isArray()) continue;
                for (JsonNode item : items) {
                    JsonNode vr = item.path("videoRenderer");
                    if (vr.isMissingNode()) continue;

                    String videoId = vr.path("videoId").asText("").strip();
                    if (!SAFE_VIDEO_ID.matcher(videoId).matches()) continue;

                    String duration = vr.path("lengthText").path("simpleText").asText("").strip();
                    if (duration.isEmpty()) continue; // bỏ qua livestream hoặc shorts không rõ thời lượng

                    String title = readRuns(vr.path("title").path("runs"));
                    if (title.isEmpty()) continue;
                    String channel = readRuns(vr.path("ownerText").path("runs"));
                    String poster = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";

                    String id = "yt-" + videoId;
                    MovieSummary summary = new MovieSummary(
                            id,
                            title,
                            "YouTube",
                            poster,
                            duration,
                            channel.isEmpty() ? "YouTube" : channel,
                            poster
                    );
                    summaryCache.put(id, summary);
                    out.add(summary);
                    if (out.size() >= limit) return out;
                }
            }
            return out;
        } catch (Exception e) {
            log.warn("Lỗi tìm kiếm YouTube cho '{}': {}", query, e.getMessage());
            return List.of();
        }
    }

    /** Fallback tìm video YouTube qua Bing Videos khi YouTube chặn IP datacenter. */
    private List<MovieSummary> fetchBingYouTubeSearch(String query, int limit) {
        try {
            String url = "https://www.bing.com/videos/search?q="
                    + URLEncoder.encode("site:youtube.com " + query, StandardCharsets.UTF_8);
            String html = http.get()
                    .uri(URI.create(url))
                    .header("Referer", "https://www.bing.com/")
                    .retrieve()
                    .body(String.class);
            if (html == null || html.isEmpty()) return List.of();

            Pattern cardPattern = Pattern.compile(
                    "youtube\\.com(?:%2F|/)watch(?:%3F|\\?)v(?:%3D|=)([A-Za-z0-9_-]{11}).{0,500}?aria-label=\"([^\"]+)\"",
                    Pattern.DOTALL);
            var matcher = cardPattern.matcher(html);
            Map<String, MovieSummary> seen = new LinkedHashMap<>();
            while (matcher.find() && seen.size() < limit) {
                String videoId = matcher.group(1);
                if (seen.containsKey("yt-" + videoId)) continue;
                String rawLabel = decodeHtmlEntities(matcher.group(2));
                String title = rawLabel
                        .replaceAll("\\s+(?:từ|from|on)\\s+YouTube.*$", "")
                        .replaceAll("\\s*·\\s*Thời lượng:.*$", "")
                        .strip();
                if (title.isEmpty()) title = "Video YouTube (" + videoId + ")";
                String poster = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";
                String id = "yt-" + videoId;
                MovieSummary summary = new MovieSummary(id, title, "YouTube", poster, "Full", "YouTube", poster);
                summaryCache.put(id, summary);
                seen.put(id, summary);
            }
            return new ArrayList<>(seen.values());
        } catch (Exception e) {
            log.warn("Lỗi fallback Bing YouTube cho '{}': {}", query, e.getMessage());
            return List.of();
        }
    }

    private static String decodeHtmlEntities(String s) {
        return s.replace("&amp;", "&")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">");
    }

    private static String readRuns(JsonNode runs) {
        if (!runs.isArray()) return "";
        StringBuilder sb = new StringBuilder();
        for (JsonNode run : runs) {
            sb.append(run.path("text").asText(""));
        }
        return sb.toString().strip();
    }
}
