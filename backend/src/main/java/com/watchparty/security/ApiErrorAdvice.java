package com.watchparty.security;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Trả lỗi vượt hạn mức dạng JSON {message} để frontend hiện đúng câu thông báo. */
@RestControllerAdvice
public class ApiErrorAdvice {

    @ExceptionHandler(TooManyRequestsException.class)
    public ResponseEntity<Map<String, String>> tooMany(TooManyRequestsException e) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "60")
                .body(Map.of("message", e.getMessage()));
    }
}
