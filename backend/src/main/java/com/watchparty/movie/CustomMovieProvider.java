package com.watchparty.movie;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import com.watchparty.movie.MovieModels.MovieDetail;
import com.watchparty.movie.MovieModels.MoviePage;

/**
 * Nguồn phim tuỳ chỉnh: gọi API phim của bạn.
 *
 * Bật bằng application.yml:
 * <pre>
 * movies:
 *   provider: custom
 *   custom:
 *     base-url: https://api-cua-ban.example.com
 * </pre>
 *
 * Mặc định class này mong đợi API trả về đúng định dạng trong {@link MovieModels}:
 * <ul>
 *   <li>GET {base-url}/movies?q=...&amp;page=1  -> MoviePage   { items:[{id,title,year,poster}], page, totalPages }</li>
 *   <li>GET {base-url}/movies/{id}             -> MovieDetail { id,title,description,year,poster, episodes:[{name,url}] }</li>
 * </ul>
 * Nếu API của bạn có format khác, sửa 2 hàm dưới đây: đọc JSON thành JsonNode
 * rồi map sang MoviePage / MovieDetail (xem ArchiveOrgMovieProvider làm ví dụ).
 */
@Component
@ConditionalOnProperty(name = "movies.provider", havingValue = "custom")
public class CustomMovieProvider implements MovieProvider {

    private final RestClient http;

    public CustomMovieProvider(@Value("${movies.custom.base-url}") String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("Chưa điền movies.custom.base-url trong application.yml");
        }
        this.http = RestClient.builder().baseUrl(baseUrl).build();
    }

    @Override
    public MoviePage search(String query, int page) {
        return http.get()
                .uri(b -> b.path("/movies").queryParam("q", query == null ? "" : query).queryParam("page", page).build())
                .retrieve()
                .body(MoviePage.class);
    }

    @Override
    public MovieDetail detail(String id) {
        return http.get().uri("/movies/{id}", id).retrieve().body(MovieDetail.class);
    }
}
