package com.watchparty.movie;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.watchparty.movie.MovieModels.MovieDetail;
import com.watchparty.movie.MovieModels.MoviePage;
import com.watchparty.movie.MovieModels.MovieSummary;

class SmartMovieSearchTest {

    private static double score(String q, String title) {
        return SmartMovieSearch.score(SmartMovieSearch.normalize(q), SmartMovieSearch.normalize(title));
    }

    @Test
    void khongDauVanKhopChinhXac() {
        assertEquals(1.0, score("pham nhan tu tien", "Phàm Nhân Tu Tiên"));
        assertEquals(1.0, score("Đảo Hải Tặc", "dao hai tac"));
    }

    @Test
    void goSaiChinhTaVanDiemCao() {
        assertTrue(score("naruto shipuden", "Naruto Shippuden") >= 0.62);
        assertTrue(score("one piec", "One Piece") >= 0.8);
        assertTrue(score("nosferatoo", "Nosferatu") >= 0.62);
        assertTrue(score("dao hai tak", "Đảo Hải Tặc") >= 0.62);
    }

    @Test
    void khongKhopBuaBai() {
        assertTrue(score("naruto", "Doraemon") < 0.62);
        assertTrue(score("tu tien", "Thám Tử Lừng Danh Conan") < 0.62);
    }

    @Test
    void xepHangDungThuTu() {
        double exact = score("tu tien", "Tu Tiên");
        double prefix = score("tu tien", "Tu Tiên Truyện");
        double contains = score("tu tien", "Phàm Nhân Tu Tiên");
        double unrelated = score("tu tien", "Avengers: Hồi Kết");
        assertTrue(exact > prefix && prefix > contains && contains > unrelated);
        assertTrue(unrelated < 0.4);
    }

    @Test
    void boTuNhieuKhiTim() {
        List<String> v = SmartMovieSearch.variants("Naruto tập 5 vietsub 2002");
        assertEquals("Naruto tập 5 vietsub 2002", v.get(0));
        assertTrue(v.contains("Naruto"), v.toString());
    }

    @Test
    void giuDauKhiCatTuNhieu() {
        List<String> v = SmartMovieSearch.variants("Phàm Nhân Tu Tiên thuyết minh");
        assertTrue(v.contains("Phàm Nhân Tu Tiên"), v.toString());
        assertTrue(v.contains("pham nhan tu tien thuyet minh"), v.toString());
    }

    @Test
    void timThongMinhBoSungKetQuaVaXepHang() {
        MovieProvider fake = new MovieProvider() {
            @Override
            public MoviePage search(String query, int page) {
                return switch (query) {
                    // nguồn chỉ tìm được khi bỏ từ nhiễu
                    case "Naruto" -> new MoviePage(List.of(
                            new MovieSummary("b", "Boruto: Naruto Next Generations", "", ""),
                            new MovieSummary("a", "Naruto", "", "")), 1, 1);
                    default -> new MoviePage(List.of(), 1, 1);
                };
            }

            @Override
            public MovieDetail detail(String id) {
                return null;
            }
        };
        SmartMovieSearch s = new SmartMovieSearch(fake);
        MoviePage r = s.search("Naruto tập 5 vietsub", "", "", 1);
        assertEquals("a", r.items().get(0).id(), "Tên trùng khớp phải lên đầu");
        assertEquals(2, r.items().size());
    }
}
