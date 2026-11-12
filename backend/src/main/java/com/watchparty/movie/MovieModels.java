package com.watchparty.movie;

import java.util.List;

/** Định dạng dữ liệu phim chuẩn mà frontend dùng, bất kể nguồn phim là gì. */
public final class MovieModels {

    private MovieModels() {
    }

    public record MovieSummary(String id, String title, String year, String poster) {
    }

    public record MoviePage(List<MovieSummary> items, int page, int totalPages) {
    }

    /** url = link mp4 hoặc m3u8 phát được trực tiếp trên trình duyệt. */
    public record Episode(String name, String url) {
    }

    public record MovieDetail(String id, String title, String description, String year, String poster,
                              List<Episode> episodes) {
    }
}
