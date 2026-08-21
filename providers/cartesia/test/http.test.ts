import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL } from "../src/config";
import { authHeaders, buildUrl } from "../src/internal/http";

describe("buildUrl", () => {
    it("falls back to the public host", () => {
        expect(buildUrl(undefined, "/tts/bytes").toString()).toBe(`${DEFAULT_BASE_URL}/tts/bytes`);
    });

    it("honours a self-hosted or regional base", () => {
        expect(buildUrl("https://self-hosted.test", "/stt").toString()).toBe("https://self-hosted.test/stt");
    });

    it("stringifies scalars", () => {
        const url = buildUrl(undefined, "/stt/websocket", { model: "ink-whisper", sample_rate: 16000 });

        expect(url.searchParams.get("model")).toBe("ink-whisper");
        expect(url.searchParams.get("sample_rate")).toBe("16000");
    });

    it("drops undefined rather than sending the string undefined", () => {
        const url = buildUrl(undefined, "/stt/websocket", { language: undefined, model: "ink-2" });

        expect(url.searchParams.has("language")).toBe(false);
        expect(url.search).toBe("?model=ink-2");
    });

    // Which is how `keyterm` travels on the STT sockets.
    it("repeats the key for an array, as the wire has it", () => {
        const url = buildUrl(undefined, "/stt/websocket", { keyterm: ["sdk", "cartesia"] });

        expect(url.searchParams.getAll("keyterm")).toEqual(["sdk", "cartesia"]);
    });
});

describe("authHeaders", () => {
    // The sockets send the same pair, so this is the single definition.
    it("carries the bearer token and the pinned schema version", () => {
        expect(authHeaders("k")).toEqual({
            Authorization: "Bearer k",
            "Cartesia-Version": "2025-11-04",
        });
    });
});
