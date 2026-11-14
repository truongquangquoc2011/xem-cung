package com.watchparty.movie;

import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.watchparty.movie.AniSkipService.SkipSegment;
import com.watchparty.movie.MovieModels.MovieDetail;
import com.watchparty.movie.MovieModels.MoviePage;
import com.watchparty.movie.MovieModels.MovieSummary;

@RestController
@RequestMapping("/api/movies")
public class MovieController {

    private static final Logger log = LoggerFactory.getLogger(MovieController.class);
    private static final Pattern SAFE_HOST = Pattern.compile("^(v\\d+\\.streamvsmov\\.com|embed\\d*\\.streamc\\.xyz)$");
    private static final Pattern SAFE_HASH = Pattern.compile("^[A-Za-z0-9-]+$");
    private static final Pattern SEGMENT_URL = Pattern.compile("(?m)^https?://[^\\r\\n]+$");
    private static final Pattern SUBTITLES_JSON = Pattern.compile("subtitles\\s*:\\s*(\\[.*?\\])", Pattern.DOTALL);

    public record SubtitleTrack(String label, String lang, String url, boolean isDefault) {
    }

    private final MovieProvider provider;
    private final AniSkipService aniSkipService;
    private final YouTubeAiMovieService youTubeAiMovieService;
    private final SmartMovieSearch smartSearch;
    private final String hlsProxyUrl;
    private final RestClient proxyHttp;
    private final ObjectMapper mapper = new ObjectMapper();

    /** Cache giữ các segment gần nhất trong RAM để khi nhiều người trong phòng cùng tải không phải tải lại từ CDN. */
    private final Map<String, byte[]> segmentCache = java.util.Collections.synchronizedMap(
            new LinkedHashMap<String, byte[]>(48, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, byte[]> eldest) {
                    return size() > 36;
                }
            });
    private final Map<String, String> playlistCache = new ConcurrentHashMap<>();
    private final Map<String, List<SubtitleTrack>> subtitleCache = new ConcurrentHashMap<>();

    public MovieController(MovieProvider provider, AniSkipService aniSkipService,
                           YouTubeAiMovieService youTubeAiMovieService, SmartMovieSearch smartSearch,
                           @Value("${app.hls-proxy-url:}") String hlsProxyUrl) {
        this.provider = provider;
        this.aniSkipService = aniSkipService;
        this.youTubeAiMovieService = youTubeAiMovieService;
        this.smartSearch = smartSearch;
        this.hlsProxyUrl = hlsProxyUrl == null ? "" : hlsProxyUrl.strip().replaceAll("/+$", "");
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_2)
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(Duration.ofSeconds(20));

        this.proxyHttp = RestClient.builder()
                .requestFactory(factory)
                .defaultHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
                .build();
    }

    @GetMapping
    public MoviePage search(
            @RequestParam(defaultValue = "") String q,
            @RequestParam(defaultValue = "") String category,
            @RequestParam(defaultValue = "") String period,
            @RequestParam(defaultValue = "1") int page) {
        String cleanQ = q == null ? "" : q.strip();
        String cleanCat = category == null ? "" : category.strip().toLowerCase();

        // Khi bấm tag Phim AI (không có từ khoá): gộp Nguồn C (phim-ai) + Phim AI trên YouTube
        if ("phim-ai".equals(cleanCat) && cleanQ.isEmpty()) {
            MoviePage base = page == 1
                    ? provider.search("", "phim-ai", period, 1)
                    : new MoviePage(List.of(), page, 1);
            if (page == 1) {
                List<MovieSummary> combined = new ArrayList<>(base.items());
                combined.addAll(youTubeAiMovieService.listDefaultAiMovies());
                return new MoviePage(combined, 1, 1);
            }
            return base;
        }

        // Tìm kiếm thông minh: không dấu, bỏ từ nhiễu, gần đúng, xếp hạng + cache ngắn hạn
        return smartSearch.search(cleanQ, cleanCat, period, page);
    }

    /** Tìm kiếm video trực tiếp trên YouTube (dùng cho tab YouTube trong phòng). */
    @GetMapping("/youtube")
    public MoviePage searchYouTube(@RequestParam(defaultValue = "") String q) {
        String cleanQ = q == null ? "" : q.strip();
        if (cleanQ.isEmpty()) {
            return new MoviePage(List.of(), 1, 1);
        }
        return new MoviePage(youTubeAiMovieService.search(cleanQ, 12), 1, 1);
    }

    /** Kho & tìm kiếm dành riêng cho Phim AI (Nguồn C phim-ai + YouTube gán mác Phim AI). */
    @GetMapping("/ai")
    public MoviePage searchAi(@RequestParam(defaultValue = "") String q) {
        String cleanQ = q == null ? "" : q.strip();
        if (cleanQ.isEmpty()) {
            MoviePage base = provider.search("", "phim-ai", "", 1);
            List<MovieSummary> combined = new ArrayList<>(base.items());
            combined.addAll(youTubeAiMovieService.listDefaultAiMovies());
            return new MoviePage(combined, 1, 1);
        }
        String ytQuery = cleanQ.toLowerCase().contains("ai") ? cleanQ : cleanQ + " phim AI";
        List<MovieSummary> ytItems = youTubeAiMovieService.search(ytQuery, 12).stream()
                .map(m -> new MovieSummary(m.id(), m.title(), "Phim AI", m.poster(),
                        m.currentEpisode(), m.quality(), m.backdrop()))
                .toList();
        return new MoviePage(ytItems, 1, 1);
    }

    @GetMapping("/{id}")
    public MovieDetail detail(@PathVariable String id) {
        if (youTubeAiMovieService.isYouTubeMovieId(id)) {
            return youTubeAiMovieService.detail(id);
        }
        return smartSearch.detail(id);
    }

    @GetMapping("/skip-times")
    public List<SkipSegment> skipTimes(
            @RequestParam(defaultValue = "") String title,
            @RequestParam(defaultValue = "") String originalTitle,
            @RequestParam(defaultValue = "1") String episode) {
        return aniSkipService.findSkipTimes(title, originalTitle, episode);
    }

    /**
     * Lấy danh sách phụ đề (.vtt) từ trang embed cho tập phim đang phát.
     * Nguồn C (streamc.xyz) đã có sẵn Vietsub cứng (hardsub) trực tiếp trong video nên trả về danh sách rỗng.
     */
    @GetMapping("/hls/{host}/{hash}/subtitles")
    public List<SubtitleTrack> getSubtitles(@PathVariable String host, @PathVariable String hash) {
        if (!SAFE_HOST.matcher(host).matches() || !SAFE_HASH.matcher(hash).matches()) {
            throw new IllegalArgumentException("Tham số không hợp lệ");
        }
        if (host.endsWith(".streamc.xyz")) {
            return List.of();
        }
        String cacheKey = host + "/" + hash;
        List<SubtitleTrack> cached = subtitleCache.get(cacheKey);
        if (cached != null) {
            return cached;
        }

        String embedUrl = "https://" + host + "/video/" + hash;
        try {
            String html = proxyHttp.get().uri(URI.create(embedUrl)).retrieve().body(String.class);
            if (html == null) {
                return List.of();
            }
            Matcher m = SUBTITLES_JSON.matcher(html);
            if (!m.find()) {
                subtitleCache.put(cacheKey, List.of());
                return List.of();
            }
            JsonNode arr = mapper.readTree(m.group(1));
            if (!arr.isArray()) {
                return List.of();
            }

            List<JsonNode> nodes = new ArrayList<>();
            arr.forEach(nodes::add);
            nodes.sort(Comparator.comparingInt(n -> langPriority(n.path("code").asText(""))));

            List<SubtitleTrack> tracks = new ArrayList<>();
            boolean defaultAssigned = false;
            java.util.Set<String> seenLangs = new java.util.HashSet<>();

            for (JsonNode n : nodes) {
                String rawUrl = n.path("url").asText("").strip();
                if (rawUrl.isEmpty()) {
                    continue;
                }
                String code = n.path("code").asText("vie").toLowerCase().strip();
                if (!seenLangs.add(code)) {
                    continue;
                }
                String fullUrl = rawUrl.startsWith("http") ? rawUrl : ("https://" + host + rawUrl);
                String proxiedUrl = "/api/movies/hls/vtt?url="
                        + java.net.URLEncoder.encode(fullUrl, StandardCharsets.UTF_8);

                String lang = mapSrclang(code);
                String label = mapLangLabel(code);
                boolean isDef = !defaultAssigned && ("vi".equals(lang) || nodes.size() == 1);
                if (isDef) {
                    defaultAssigned = true;
                }
                tracks.add(new SubtitleTrack(label, lang, proxiedUrl, isDef));
            }
            if (!defaultAssigned && !tracks.isEmpty()) {
                SubtitleTrack first = tracks.get(0);
                tracks.set(0, new SubtitleTrack(first.label(), first.lang(), first.url(), true));
            }
            subtitleCache.put(cacheKey, tracks);
            return tracks;
        } catch (Exception e) {
            log.warn("Không lấy được phụ đề từ {}: {}", embedUrl, e.getMessage());
            return List.of();
        }
    }

    /**
     * Proxy file phụ đề WebVTT (.vtt) kèm UTF-8 và CORS.
     */
    @GetMapping(value = "/hls/vtt", produces = "text/vtt;charset=UTF-8")
    public ResponseEntity<byte[]> proxyVtt(@RequestParam String url) {
        URI uri;
        try {
            uri = URI.create(url);
        } catch (Exception e) {
            throw new IllegalArgumentException("URL phụ đề không hợp lệ");
        }
        String host = uri.getHost();
        if (host == null || !host.endsWith(".streamvsmov.com")) {
            throw new IllegalArgumentException("Host phụ đề không được phép");
        }

        byte[] bytes = proxyHttp.get()
                .uri(uri)
                .header("Origin", "https://" + host)
                .header("Referer", "https://" + host + "/")
                .retrieve()
                .body(byte[].class);

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, "text/vtt; charset=utf-8")
                .cacheControl(CacheControl.maxAge(Duration.ofHours(24)).cachePublic())
                .body(bytes);
    }

    /**
     * Proxy playlist master.m3u8 của Nguồn C (streamc.xyz) hoặc VSMOV (streamvsmov.com)
     * và viết lại các URL segment để tránh lỗi CORS trên trình duyệt.
     */
    @GetMapping(value = "/hls/{host}/{hash}/master.m3u8", produces = "application/vnd.apple.mpegurl")
    public ResponseEntity<String> proxyMasterPlaylist(@PathVariable String host, @PathVariable String hash) {
        if (!SAFE_HOST.matcher(host).matches() || !SAFE_HASH.matcher(hash).matches()) {
            throw new IllegalArgumentException("Tham số HLS không hợp lệ");
        }
        String cacheKey = host + "/" + hash;
        String cached = playlistCache.get(cacheKey);
        if (cached != null) {
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_TYPE, "application/vnd.apple.mpegurl; charset=utf-8")
                    .cacheControl(CacheControl.maxAge(Duration.ofHours(2)).cachePublic())
                    .body(cached);
        }

        String m3u8;
        if (host.endsWith(".streamc.xyz")) {
            m3u8 = fetchNguonCPlaylist(host, hash);
        } else {
            String upstreamUrl = "https://" + host + "/stream/" + hash + "/master.m3u8";
            m3u8 = proxyHttp.get()
                    .uri(URI.create(upstreamUrl))
                    .retrieve()
                    .body(String.class);
        }

        if (m3u8 == null || m3u8.isBlank()) {
            throw new IllegalArgumentException("Không tải được playlist HLS");
        }

        String segPrefix = hlsProxyUrl.isEmpty() ? "../../segment" : (hlsProxyUrl + "/seg");
        Matcher m = SEGMENT_URL.matcher(m3u8);
        StringBuilder rewritten = new StringBuilder(m3u8.length() + 4096);
        while (m.find()) {
            String segUrl = m.group().strip();
            String proxied = segPrefix + "?host="
                    + java.net.URLEncoder.encode(host, StandardCharsets.UTF_8)
                    + "&url="
                    + java.net.URLEncoder.encode(segUrl, StandardCharsets.UTF_8);
            m.appendReplacement(rewritten, Matcher.quoteReplacement(proxied));
        }
        m.appendTail(rewritten);

        String result = rewritten.toString();
        playlistCache.put(cacheKey, result);

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, "application/vnd.apple.mpegurl; charset=utf-8")
                .cacheControl(CacheControl.maxAge(Duration.ofHours(2)).cachePublic())
                .body(result);
    }

    /**
     * Gọi bootstrap API của Nguồn C (embed*.streamc.xyz) để lấy preissued HLS playlist.
     */
    private String fetchNguonCPlaylist(String host, String hash) {
        String embedUrl = "https://" + host + "/embed.php?hash=" + hash;
        Map<String, Object> bootstrapPayload = Map.of(
                "action", "bootstrap",
                "referrer", "https://phim.nguonc.com/",
                "frame_origins", List.of("https://phim.nguonc.com"),
                "request_grant", true,
                "playlist_format", "hls",
                "pretty_url", true,
                "path_chunks", true,
                "bootstrap_format", "json"
        );

        JsonNode boot = proxyHttp.post()
                .uri(URI.create(embedUrl))
                .contentType(MediaType.APPLICATION_JSON)
                .header("Origin", "https://" + host)
                .header("Referer", embedUrl)
                .body(bootstrapPayload)
                .retrieve()
                .body(JsonNode.class);

        if (boot == null) {
            throw new IllegalArgumentException("Không khởi tạo được luồng phát từ Nguồn C");
        }
        String playlistUrl = boot.path("preissued").path("playlist").asText("").strip();
        if (playlistUrl.isEmpty()) {
            throw new IllegalArgumentException("Nguồn C không trả về playlist HLS");
        }

        byte[] playlistBytes = proxyHttp.get()
                .uri(URI.create(playlistUrl))
                .header("Origin", "https://" + host)
                .header("Referer", embedUrl)
                .retrieve()
                .body(byte[].class);

        if (playlistBytes == null || playlistBytes.length == 0) {
            return "";
        }
        return new String(playlistBytes, StandardCharsets.UTF_8);
    }

    /**
     * Proxy từng segment HLS từ CDN về trình duyệt kèm cache RAM và HTTP/2 connection pooling.
     */
    @GetMapping({"/hls/segment", "/hls/{pathHost}/segment"})
    public ResponseEntity<byte[]> proxySegment(
            @RequestParam String url,
            @RequestParam(defaultValue = "embed1.streamc.xyz") String host) {
        byte[] cached = segmentCache.get(url);
        if (cached != null) {
            return ResponseEntity.ok()
                    .contentType(MediaType.valueOf("video/mp2t"))
                    .cacheControl(CacheControl.maxAge(Duration.ofHours(6)).cachePublic())
                    .body(cached);
        }

        // Chống SSRF: kiểm tra IP thật sau khi phân giải DNS (chặn mọi dải mạng nội bộ / metadata cloud)
        URI uri = PublicUrlGuard.requirePublicHttpUrl(url);
        String segHost = uri.getHost();

        String originHost = SAFE_HOST.matcher(host).matches()
                ? (host.endsWith(".streamvsmov.com") ? "v10.streamvsmov.com" : host)
                : (segHost.endsWith(".streamvsmov.com") ? "v10.streamvsmov.com" : "embed1.streamc.xyz");

        byte[] bytes = proxyHttp.get()
                .uri(uri)
                .header("Origin", "https://" + originHost)
                .header("Referer", "https://" + originHost + "/")
                .retrieve()
                .body(byte[].class);

        if (bytes != null && bytes.length > 0 && bytes.length <= 8 * 1024 * 1024) {
            segmentCache.put(url, bytes);
        }

        return ResponseEntity.ok()
                .contentType(MediaType.valueOf("video/mp2t"))
                .cacheControl(CacheControl.maxAge(Duration.ofHours(6)).cachePublic())
                .body(bytes);
    }

    private static int langPriority(String code) {
        String c = code == null ? "" : code.toLowerCase();
        if (c.startsWith("vie") || c.startsWith("vi")) return 1;
        if (c.startsWith("eng") || c.startsWith("en")) return 2;
        return 10;
    }

    private static String mapSrclang(String code) {
        if (code.startsWith("vie") || code.startsWith("vi")) return "vi";
        if (code.startsWith("eng") || code.startsWith("en")) return "en";
        if (code.startsWith("chi") || code.startsWith("zh")) return "zh";
        if (code.startsWith("kor") || code.startsWith("ko")) return "ko";
        if (code.startsWith("jpn") || code.startsWith("ja")) return "ja";
        return code.length() >= 2 ? code.substring(0, 2) : "vi";
    }

    private static String mapLangLabel(String code) {
        if (code.startsWith("vie") || code.startsWith("vi")) return "Tiếng Việt";
        if (code.startsWith("eng") || code.startsWith("en")) return "Tiếng Anh";
        if (code.startsWith("chi") || code.startsWith("zh")) return "Tiếng Trung";
        if (code.startsWith("kor") || code.startsWith("ko")) return "Tiếng Hàn";
        if (code.startsWith("jpn") || code.startsWith("ja")) return "Tiếng Nhật";
        return code.toUpperCase();
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("message", e.getMessage()));
    }

    @ExceptionHandler(RestClientException.class)
    public ResponseEntity<Map<String, String>> upstream(RestClientException e) {
        log.warn("Lỗi gọi API phim: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(Map.of("message", "Không lấy được dữ liệu từ nguồn phim"));
    }
}
