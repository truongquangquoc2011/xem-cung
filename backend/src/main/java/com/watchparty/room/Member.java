package com.watchparty.room;

public record Member(String id, String name, boolean inVoice, boolean muted, boolean deafened, boolean host) {
    public Member(String id, String name) {
        this(id, name, false, false, false, false);
    }

    public Member(String id, String name, boolean inVoice, boolean muted, boolean deafened) {
        this(id, name, inVoice, muted, deafened, false);
    }
}
