package com.watchparty.movie;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import com.fasterxml.jackson.databind.JsonNode;
import com.watchparty.movie.MovieModels.Episode;
import com.watchparty.movie.MovieModels.MovieDetail;
import com.watchparty.movie.MovieModels.MoviePage;
import com.watchparty.movie.MovieModels.MovieSummary;

/**
 * Lấy phim từ Internet Archive, bộ sưu tập "feature_films" (phim thuộc phạm vi công cộng).
 * API: https://archive.org/advancedsearch.php và https://archive.org/metadata/{id}
 */
@Component
@ConditionalOnProperty(name = "movies.provider", havingValue = "archive", matchIfMissing = true)
public class ArchiveOrgMovieProvider implements MovieProvider {

    private static final int PAGE_SIZE = 24;
    private static final Pattern SAFE_QUERY = Pattern.compile("[^\\p{L}\\p{N} ]");
    private static final Pattern HTML_TAG = Pattern.compile("<[^>]+>");
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9._-]+");

    private final RestClient http = RestClient.builder()
            .defaultHeader("User-Agent", "watch-party-demo/1.0")
            .build();

    @Override
    public MoviePage search(String query, int page) {
        // Chỉ lấy phim có file mp4 phát được trên trình duyệt
        String q = "collection:(feature_films) AND mediatype:(movies) AND format:(h.264 OR MPEG4)";
        String clean = query == null ? "" : SAFE_QUERY.matcher(query).replaceAll(" ").strip();
        if (!clean.isEmpty()) {
            q += " AND title:(" + clean + ")";
        }
        int p = Math.max(1, page);
        URI uri = UriComponentsBuilder.fromUriString("https://archive.org/advancedsearch.php")
                .queryParam("q", q)
                .queryParam("fl[]", "identifier", "title", "year")
                .queryParam("sort[]", "downloads desc")
                .queryParam("rows", PAGE_SIZE)
                .queryParam("page", p)
                .queryParam("output", "json")
                .encode()
                .build()
                .toUri();

        JsonNode res = http.get().uri(uri).retrieve().body(JsonNode.class).path("response");
        List<MovieSummary> items = new ArrayList<>();
        for (JsonNode doc : res.path("docs")) {
            String id = doc.path("identifier").asText();
            items.add(new MovieSummary(id, text(doc.path("title")), text(doc.path("year")), poster(id)));
        }
        int total = res.path("numFound").asInt(0);
        int totalPages = Math.max(1, (int) Math.ceil(total / (double) PAGE_SIZE));
        return new MoviePage(items, p, totalPages);
    }

    @Override
    public MovieDetail detail(String id) {
        if (id == null || !SAFE_ID.matcher(id).matches()) {
            throw new IllegalArgumentException("Mã phim không hợp lệ");
        }
        JsonNode res = http.get().uri("https://archive.org/metadata/{id}", id).retrieve().body(JsonNode.class);
        JsonNode meta = res.path("metadata");
        if (meta.isMissingNode() || meta.isEmpty()) {
            throw new IllegalArgumentException("Không tìm thấy phim");
        }

        List<JsonNode> mp4s = new ArrayList<>();
        for (JsonNode f : res.path("files")) {
            if (f.path("name").asText().toLowerCase().endsWith(".mp4")) {
                mp4s.add(f);
            }
        }
        // Ưu tiên bản h.264 do Archive tự encode (nhẹ, phát tốt trên trình duyệt)
        boolean hasH264 = mp4s.stream().anyMatch(f -> "h.264".equalsIgnoreCase(f.path("format").asText()));
        List<Episode> episodes = mp4s.stream()
                .filter(f -> !hasH264 || "h.264".equalsIgnoreCase(f.path("format").asText()))
                .map(f -> f.path("name").asText())
                .sorted(Comparator.naturalOrder())
                .map(name -> new Episode(prettyName(name), downloadUrl(id, name)))
                .toList();

        String description = HTML_TAG.matcher(text(meta.path("description"))).replaceAll("").strip();
        return new MovieDetail(id, text(meta.path("title")), description, text(meta.path("year")),
                poster(id), episodes);
    }

    private static String poster(String id) {
        return "https://archive.org/services/img/" + id;
    }

    private static String downloadUrl(String id, String fileName) {
        String encoded = URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");
        return "https://archive.org/download/" + id + "/" + encoded.replace("%2F", "/");
    }

    private static String prettyName(String fileName) {
        String base = fileName.contains("/") ? fileName.substring(fileName.lastIndexOf('/') + 1) : fileName;
        return base.replaceAll("(?i)\\.mp4$", "").replace('_', ' ');
    }

    /** Một số trường của Archive có thể là mảng; lấy phần tử đầu. */
    private static String text(JsonNode n) {
        if (n == null || n.isMissingNode() || n.isNull()) {
            return "";
        }
        return n.isArray() ? (n.isEmpty() ? "" : n.get(0).asText()) : n.asText();
    }
}
