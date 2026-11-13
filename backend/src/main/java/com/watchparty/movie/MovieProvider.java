package com.watchparty.movie;

import com.watchparty.movie.MovieModels.MovieDetail;
import com.watchparty.movie.MovieModels.MoviePage;

/**
 * Nguồn phim cho "Kho phim". Muốn đổi nguồn: viết 1 class implement interface này
 * và bật nó bằng movies.provider trong application.yml.
 */
public interface MovieProvider {

    /** query rỗng = danh sách mặc định (phổ biến / mới). page bắt đầu từ 1. */
    MoviePage search(String query, int page);

    default MoviePage search(String query, String category, String period, int page) {
        return search(query, page);
    }

    MovieDetail detail(String id);
}
