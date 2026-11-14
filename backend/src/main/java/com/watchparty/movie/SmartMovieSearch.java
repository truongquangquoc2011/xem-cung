package com.watchparty.movie;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;

import com.watchparty.movie.MovieModels.MovieDetail;
import com.watchparty.movie.MovieModels.MoviePage;
import com.watchparty.movie.MovieModels.MovieSummary;

/**
 * Tìm kiếm "thông minh" bọc quanh bất kỳ {@link MovieProvider} nào (không phụ thuộc nguồn phim cụ thể).
 *
 * <ul>
 *   <li>So khớp không dấu: "pham nhan tu tien" vẫn ra "Phàm Nhân Tu Tiên".</li>
 *   <li>Bỏ từ nhiễu khi API nguồn tìm không ra: "naruto tập 5 vietsub 2002" -> thử thêm "naruto".</li>
 *   <li>Chịu lỗi gõ sai: so khớp gần đúng với các tên phim đã từng thấy (chỉ mục trong RAM).</li>
 *   <li>Xếp hạng kết quả theo độ giống với từ khoá (trùng khớp > bắt đầu bằng > chứa đủ từ > gần giống).</li>
 *   <li>Cache ngắn hạn kết quả tìm kiếm / danh sách / chi tiết để giảm số lần gọi API nguồn.</li>
 * </ul>
 */
@Service
public class SmartMovieSearch {

    private static final Logger log = LoggerFactory.getLogger(SmartMovieSearch.class);

    private static final int MAX_QUERY_LENGTH = 80;
    private static final int MAX_UPSTREAM_CALLS = 3;
    private static final int ENOUGH_RESULTS = 12;
    private static final int MAX_FUZZY_EXTRA = 8;
    private static final double FUZZY_MIN_SCORE = 0.62;

    private static final long LIST_TTL_MS = 5 * 60_000L;
    private static final long DETAIL_TTL_MS = 10 * 60_000L;

    private static final Pattern DIACRITICS = Pattern.compile("\\p{M}+");
    private static final Pattern NON_ALNUM = Pattern.compile("[^a-z0-9]+");
    /** Từ nhiễu người dùng hay gõ kèm tên phim (đã bỏ dấu). */
    private static final Pattern NOISE = Pattern.compile(
            "\\b(tap|ep|episode|tap phim)\\s*\\d+\\b"
                    + "|\\b(full|hd|fhd|4k|1080p|720p|vietsub|viet sub|thuyet minh|long tieng|phu de|engsub|trailer|phim|bo phim|xem)\\b"
                    + "|\\b(19|20)\\d{2}\\b");

    private final MovieProvider provider;

    private final Map<String, CacheEntry<MoviePage>> pageCache = lru(300);
    private final Map<String, CacheEntry<MovieDetail>> detailCache = lru(200);
    /** Chỉ mục tên phim đã thấy (id -> phim) để gợi ý gần đúng khi gõ sai. */
    private final Map<String, MovieSummary> titleIndex = lru(5000);

    public SmartMovieSearch(MovieProvider provider) {
        this.provider = provider;
    }

    // ------------------------------------------------------------------ API

    public MoviePage search(String rawQuery, String category, String period, int page) {
        String query = cleanQuery(rawQuery);
        String cat = category == null ? "" : category.strip().toLowerCase(Locale.ROOT);
        String per = period == null ? "" : period.strip().toLowerCase(Locale.ROOT);
        int p = Math.max(1, Math.min(page, 500));

        String key = query.toLowerCase(Locale.ROOT) + "|" + cat + "|" + per + "|" + p;
        MoviePage cached = get(pageCache, key);
        if (cached != null) {
            return cached;
        }

        MoviePage result = query.isEmpty() ? provider.search("", cat, per, p) : smartSearch(query, cat, per, p);
        index(result.items());
        put(pageCache, key, result, LIST_TTL_MS);
        return result;
    }

    public MovieDetail detail(String id) {
        MovieDetail cached = get(detailCache, id);
        if (cached != null) {
            return cached;
        }
        MovieDetail d = provider.detail(id);
        put(detailCache, id, d, DETAIL_TTL_MS);
        return d;
    }

    /** Ghi nhận thêm phim vào chỉ mục (vd. danh sách lấy từ nguồn khác). */
    public void index(List<MovieSummary> items) {
        if (items == null) {
            return;
        }
        synchronized (titleIndex) {
            for (MovieSummary m : items) {
                if (m != null && m.id() != null && m.title() != null && !m.title().isBlank()) {
                    titleIndex.put(m.id(), m);
                }
            }
        }
    }

    // ------------------------------------------------------------- Tìm kiếm

    private MoviePage smartSearch(String query, String cat, String per, int page) {
        LinkedHashMap<String, MovieSummary> merged = new LinkedHashMap<>();
        int totalPages = 1;
        RestClientException firstError = null;
        int calls = 0;

        for (String variant : variants(query)) {
            if (calls >= MAX_UPSTREAM_CALLS) {
                break;
            }
            // Biến thể phụ chỉ dùng khi kết quả còn ít (giảm số lần gọi API nguồn)
            if (calls > 0 && merged.size() >= ENOUGH_RESULTS) {
                break;
            }
            // Trang > 1 chỉ dùng đúng từ khoá gốc để phân trang ổn định
            if (calls > 0 && page > 1) {
                break;
            }
            calls++;
            try {
                MoviePage r = provider.search(variant, cat, per, page);
                if (calls == 1) {
                    totalPages = Math.max(1, r.totalPages());
                }
                for (MovieSummary m : r.items()) {
                    merged.putIfAbsent(m.id(), m);
                }
            } catch (RestClientException e) {
                if (firstError == null) {
                    firstError = e;
                }
                log.debug("Tìm '{}' thất bại: {}", variant, e.getMessage());
            }
        }

        // Gần đúng từ chỉ mục: cứu các trường hợp gõ sai chính tả / thiếu dấu
        if (page == 1) {
            addFuzzyMatches(query, merged);
        }

        if (merged.isEmpty() && firstError != null) {
            throw firstError;
        }

        String nq = normalize(query);
        String core = coreQuery(query);
        List<MovieSummary> ranked = new ArrayList<>(merged.values());
        Map<String, Double> scores = new HashMap<>();
        for (MovieSummary m : ranked) {
            String nt = normalize(m.title());
            // Chấm theo cả câu gốc lẫn phần lõi (đã bỏ "tập 5", "vietsub", năm...) — lấy điểm cao hơn
            scores.put(m.id(), Math.max(score(nq, nt), core.isEmpty() ? 0 : score(core, nt)));
        }
        // Sắp xếp ổn định: điểm cao lên trước, cùng điểm giữ thứ tự gốc của nguồn
        List<MovieSummary> sorted = new ArrayList<>(ranked);
        sorted.sort(Comparator.comparingDouble((MovieSummary m) -> scores.get(m.id())).reversed());
        return new MoviePage(sorted, page, totalPages);
    }

    /** Từ khoá đã chuẩn hoá và bỏ từ nhiễu (rỗng nếu bỏ xong không còn gì). */
    static String coreQuery(String query) {
        String plain = stripDiacritics(query).toLowerCase(Locale.ROOT);
        return normalize(NOISE.matcher(plain).replaceAll(" "));
    }

    private void addFuzzyMatches(String query, Map<String, MovieSummary> merged) {
        String core = coreQuery(query);
        String nq = core.isEmpty() ? normalize(query) : core;
        if (nq.length() < 3) {
            return;
        }
        List<Map.Entry<MovieSummary, Double>> candidates = new ArrayList<>();
        synchronized (titleIndex) {
            for (MovieSummary m : titleIndex.values()) {
                if (merged.containsKey(m.id())) {
                    continue;
                }
                double s = score(nq, normalize(m.title()));
                if (s >= FUZZY_MIN_SCORE) {
                    candidates.add(Map.entry(m, s));
                }
            }
        }
        candidates.sort(Map.Entry.<MovieSummary, Double>comparingByValue().reversed());
        for (int i = 0; i < Math.min(MAX_FUZZY_EXTRA, candidates.size()); i++) {
            MovieSummary m = candidates.get(i).getKey();
            merged.putIfAbsent(m.id(), m);
        }
    }

    /** Các biến thể từ khoá, theo thứ tự ưu tiên, không trùng nhau. */
    static List<String> variants(String query) {
        Set<String> out = new LinkedHashSet<>();
        out.add(query);

        String plain = stripDiacritics(query).toLowerCase(Locale.ROOT);
        String withoutNoise = NOISE.matcher(plain).replaceAll(" ").replaceAll("\\s+", " ").strip();
        if (!withoutNoise.isEmpty() && !withoutNoise.equals(plain)) {
            // Giữ chữ có dấu nếu người dùng gõ có dấu: chỉ cắt bớt số từ tương ứng
            out.add(trimToWordsOf(query, withoutNoise));
        }
        if (!plain.equals(query.toLowerCase(Locale.ROOT))) {
            out.add(plain);
        }
        String[] words = withoutNoise.isEmpty() ? plain.split(" ") : withoutNoise.split(" ");
        if (words.length >= 3) {
            int keep = (int) Math.ceil(words.length * 0.6);
            out.add(String.join(" ", java.util.Arrays.copyOf(words, keep)));
        }
        out.removeIf(String::isBlank);
        return new ArrayList<>(out);
    }

    /** Lấy các từ gốc (còn dấu) của query mà khi bỏ dấu nằm trong cleaned. */
    private static String trimToWordsOf(String original, String cleaned) {
        Set<String> keepWords = Set.of(cleaned.split(" "));
        List<String> kept = new ArrayList<>();
        for (String w : original.split("\\s+")) {
            if (keepWords.contains(stripDiacritics(w).toLowerCase(Locale.ROOT))) {
                kept.add(w);
            }
        }
        String joined = String.join(" ", kept).strip();
        return joined.isEmpty() ? cleaned : joined;
    }

    // -------------------------------------------------------- Chấm điểm

    /**
     * Điểm giống nhau 0..1 giữa từ khoá và tên phim (đều đã chuẩn hoá).
     * Kết hợp: trùng khớp, tiền tố, chứa cụm, độ phủ từ (cho phép sai 1-2 ký tự), bigram Dice.
     */
    static double score(String q, String title) {
        if (q.isEmpty() || title.isEmpty()) {
            return 0;
        }
        if (title.equals(q)) {
            return 1.0;
        }
        if (title.startsWith(q + " ") || title.startsWith(q)) {
            return 0.92;
        }
        if ((" " + title + " ").contains(" " + q + " ")) {
            return 0.85;
        }
        if (title.contains(q)) {
            return 0.8;
        }

        String[] qt = q.split(" ");
        String[] tt = title.split(" ");
        double matched = 0;
        for (String w : qt) {
            double best = 0;
            for (String t : tt) {
                if (t.equals(w)) {
                    best = 1;
                    break;
                }
                if (w.length() >= 2 && t.startsWith(w)) {
                    best = Math.max(best, 0.9);
                } else if (w.length() >= 4) {
                    int allowed = w.length() >= 7 ? 2 : 1;
                    if (Math.abs(t.length() - w.length()) <= allowed && levenshtein(w, t, allowed) <= allowed) {
                        best = Math.max(best, 0.75);
                    }
                }
            }
            matched += best;
        }
        double coverage = matched / qt.length;
        // coverage = trung bình độ khớp từng từ (khớp đúng 1.0, gõ sai 1-2 ký tự 0.75)
        double tokenScore = coverage >= 0.999 ? 0.75 : 0.2 + 0.6 * coverage;
        double dice = dice(q, title);
        return Math.max(tokenScore * (coverage > 0 ? 1 : 0), dice * 0.7);
    }

    private static double dice(String a, String b) {
        if (a.length() < 2 || b.length() < 2) {
            return 0;
        }
        Map<String, Integer> grams = new HashMap<>();
        for (int i = 0; i < a.length() - 1; i++) {
            grams.merge(a.substring(i, i + 2), 1, Integer::sum);
        }
        int overlap = 0;
        for (int i = 0; i < b.length() - 1; i++) {
            String g = b.substring(i, i + 2);
            Integer c = grams.get(g);
            if (c != null && c > 0) {
                overlap++;
                grams.put(g, c - 1);
            }
        }
        return 2.0 * overlap / ((a.length() - 1) + (b.length() - 1));
    }

    /** Levenshtein có cắt sớm khi vượt ngưỡng (nhanh với từ ngắn). */
    private static int levenshtein(String a, String b, int max) {
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) {
            prev[j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            int rowMin = cur[0];
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
                rowMin = Math.min(rowMin, cur[j]);
            }
            if (rowMin > max) {
                return max + 1;
            }
            int[] tmp = prev;
            prev = cur;
            cur = tmp;
        }
        return prev[b.length()];
    }

    // ------------------------------------------------------ Chuẩn hoá chữ

    static String cleanQuery(String raw) {
        if (raw == null) {
            return "";
        }
        String q = raw.replaceAll("[\\p{Cntrl}]", " ").replaceAll("\\s+", " ").strip();
        return q.length() > MAX_QUERY_LENGTH ? q.substring(0, MAX_QUERY_LENGTH).strip() : q;
    }

    static String stripDiacritics(String s) {
        String noMarks = DIACRITICS.matcher(Normalizer.normalize(s, Normalizer.Form.NFD)).replaceAll("");
        return noMarks.replace('đ', 'd').replace('Đ', 'D');
    }

    /** Thường hoá: bỏ dấu, chữ thường, bỏ ký tự đặc biệt. */
    static String normalize(String s) {
        if (s == null) {
            return "";
        }
        String plain = stripDiacritics(s).toLowerCase(Locale.ROOT);
        return NON_ALNUM.matcher(plain).replaceAll(" ").replaceAll("\\s+", " ").strip();
    }

    // ------------------------------------------------------------- Cache

    private record CacheEntry<T>(T value, long expiresAt) {
    }

    private static <K, V> Map<K, V> lru(int maxSize) {
        return Collections.synchronizedMap(new LinkedHashMap<K, V>(64, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
                return size() > maxSize;
            }
        });
    }

    private static <T> T get(Map<String, CacheEntry<T>> cache, String key) {
        CacheEntry<T> e = cache.get(key);
        if (e == null) {
            return null;
        }
        if (e.expiresAt() < System.currentTimeMillis()) {
            cache.remove(key);
            return null;
        }
        return e.value();
    }

    private static <T> void put(Map<String, CacheEntry<T>> cache, String key, T value, long ttlMs) {
        if (value != null) {
            cache.put(key, new CacheEntry<>(value, System.currentTimeMillis() + ttlMs));
        }
    }
}
