package com.watchparty.movie;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Tra cứu mốc thời gian Opening (op) và Ending (ed) cho Anime qua Jikan (MyAnimeList) + AniSkip API.
 * Toàn bộ kết quả được cache trong RAM để phản hồi tức thì cho cả phòng xem chung.
 */
@Service
public class AniSkipService {

    private static final Logger log = LoggerFactory.getLogger(AniSkipService.class);
    private static final Pattern EPISODE_NUMBER = Pattern.compile("(\\d+)");
    private static final Pattern PARENS = Pattern.compile("\\([^)]*\\)");

    public record SkipSegment(String type, double startTime, double endTime) {
    }

    private final RestClient aniListHttp;
    private final RestClient aniSkipHttp;
    private final Map<String, Optional<Integer>> malIdCache = new ConcurrentHashMap<>();
    private final Map<String, List<SkipSegment>> skipCache = new ConcurrentHashMap<>();

    public AniSkipService() {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(4))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(client);
        factory.setReadTimeout(Duration.ofSeconds(5));

        this.aniListHttp = RestClient.builder()
                .baseUrl("https://graphql.anilist.co")
                .requestFactory(factory)
                .defaultHeader("User-Agent", "XemCung/1.0")
                .build();
        this.aniSkipHttp = RestClient.builder()
                .baseUrl("https://api.aniskip.com/v2")
                .requestFactory(factory)
                .defaultHeader("User-Agent", "XemCung/1.0")
                .build();
    }

    public List<SkipSegment> findSkipTimes(String title, String originalTitle, String episodeName) {
        int ep = parseEpisodeNumber(episodeName);
        if (ep <= 0) {
            return List.of();
        }
        List<String> candidates = new ArrayList<>();
        addCandidates(candidates, originalTitle);
        addCandidates(candidates, title);
        if (candidates.isEmpty()) {
            return List.of();
        }

        String cacheKey = candidates.get(0).toLowerCase() + "#" + ep;
        List<SkipSegment> cached = skipCache.get(cacheKey);
        if (cached != null) {
            return cached;
        }

        Optional<Integer> malId = Optional.empty();
        for (String candidate : candidates) {
            malId = resolveMalId(candidate);
            if (malId.isPresent()) {
                break;
            }
        }
        if (malId.isEmpty()) {
            skipCache.put(cacheKey, List.of());
            return List.of();
        }

        List<SkipSegment> segments = fetchAniSkip(malId.get(), ep);
        skipCache.put(cacheKey, segments);
        return segments;
    }

    private static void addCandidates(List<String> out, String raw) {
        if (raw == null || raw.isBlank()) {
            return;
        }
        for (String part : raw.split("[,;|/]")) {
            // Ưu tiên giữ nội dung trong ngoặc (vd: "Black Clover (Season 2)" -> "Black Clover Season 2")
            String withSeason = part.replace("(", " ").replace(")", " ").replaceAll("\\s+", " ").strip();
            if (!withSeason.isEmpty() && !out.contains(withSeason) && out.size() < 4) {
                out.add(withSeason);
            }
            // Chỉ fallback bỏ ngoặc nếu thực sự có ngoặc (vd: "(2024)", "(Phần 3)")
            String noParens = cleanTitle(part);
            if (!noParens.isEmpty() && !noParens.equals(withSeason) && !out.contains(noParens) && out.size() < 4) {
                out.add(noParens);
            }
        }
    }

    private Optional<Integer> resolveMalId(String query) {
        String key = query.toLowerCase();
        Optional<Integer> cached = malIdCache.get(key);
        if (cached != null) {
            return cached;
        }
        try {
            Map<String, Object> payload = Map.of(
                    "query", "query($s:String){Media(search:$s,type:ANIME){idMal}}",
                    "variables", Map.of("s", query)
            );
            JsonNode root = aniListHttp.post()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload)
                    .retrieve()
                    .body(JsonNode.class);
            int id = root != null ? root.path("data").path("Media").path("idMal").asInt(0) : 0;
            if (id > 0) {
                Optional<Integer> found = Optional.of(id);
                malIdCache.put(key, found);
                return found;
            }
        } catch (Exception e) {
            log.debug("AniList lookup failed for '{}': {}", query, e.getMessage());
        }
        malIdCache.put(key, Optional.empty());
        return Optional.empty();
    }

    private List<SkipSegment> fetchAniSkip(int malId, int episode) {
        try {
            JsonNode root = aniSkipHttp.get()
                    .uri(b -> b.path("/skip-times/{malId}/{episode}")
                            .queryParam("types", "op", "ed")
                            .queryParam("episodeLength", 0)
                            .build(malId, episode))
                    .retrieve()
                    .body(JsonNode.class);
            if (root == null || !root.path("found").asBoolean(false)) {
                return List.of();
            }
            List<SkipSegment> list = new ArrayList<>();
            for (JsonNode item : root.path("results")) {
                String type = item.path("skipType").asText("");
                JsonNode interval = item.path("interval");
                double start = interval.path("startTime").asDouble(-1);
                double end = interval.path("endTime").asDouble(-1);
                if ((type.equals("op") || type.equals("ed")) && start >= 0 && end > start) {
                    list.add(new SkipSegment(type, start, end));
                }
            }
            return List.copyOf(list);
        } catch (Exception e) {
            log.debug("AniSkip lookup miss for malId={} ep={}: {}", malId, episode, e.getMessage());
            return List.of();
        }
    }

    static int parseEpisodeNumber(String episodeName) {
        if (episodeName == null || episodeName.isBlank()) {
            return 1;
        }
        String withoutServer = PARENS.matcher(episodeName).replaceAll(" ").strip();
        Matcher m = EPISODE_NUMBER.matcher(withoutServer);
        if (m.find()) {
            try {
                return Integer.parseInt(m.group(1));
            } catch (NumberFormatException ignored) {
                return 1;
            }
        }
        return 1;
    }

    private static String cleanTitle(String raw) {
        return PARENS.matcher(raw).replaceAll(" ").replaceAll("\\s+", " ").strip();
    }
}
