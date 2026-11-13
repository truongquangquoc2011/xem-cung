package com.watchparty.movie;

import java.util.List;

/** Định dạng dữ liệu phim chuẩn mà frontend dùng, bất kể nguồn phim là gì. */
public final class MovieModels {

    private MovieModels() {
    }

    public record MovieSummary(String id, String title, String year, String poster,
                               String currentEpisode, String quality, String backdrop) {
        public MovieSummary(String id, String title, String year, String poster) {
            this(id, title, year, poster, "", "", poster);
        }

        public MovieSummary(String id, String title, String year, String poster,
                            String currentEpisode, String quality) {
            this(id, title, year, poster, currentEpisode, quality, poster);
        }
    }

    public record MoviePage(List<MovieSummary> items, int page, int totalPages) {
    }

    /** url = link mp4 hoặc m3u8 phát được trực tiếp trên trình duyệt. */
    public record Episode(String name, String url) {
    }

    public record MovieDetail(String id, String title, String originalTitle, String description, String year,
                              String poster, List<Episode> episodes) {
        public MovieDetail(String id, String title, String description, String year, String poster,
                           List<Episode> episodes) {
            this(id, title, "", description, year, poster, episodes);
        }
    }
}
