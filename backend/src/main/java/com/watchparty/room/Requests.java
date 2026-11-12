package com.watchparty.room;

/** Payload client gửi lên qua STOMP. */
public final class Requests {

    private Requests() {
    }

    public record Join(String name) {
    }

    public record Chat(String text) {
    }

    /** action = play | pause | seek | load. source chỉ cần khi load. */
    public record Control(String action, Double position, VideoSource source) {
    }
}
