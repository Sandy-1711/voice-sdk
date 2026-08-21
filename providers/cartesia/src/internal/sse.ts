/**
 * Cartesia's `/tts/sse` endpoint is the only server-sent-event surface in this
 * SDK, so the parser lives here rather than in core.
 *
 * Only `data:` is read. Cartesia sends no `event:` or `id:` lines, and its
 * payloads carry their own `type` field, so the SSE framing is pure transport.
 */
export async function* sseEvents<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // A frame ends at a blank line, and one read can carry several
            // frames or half of one.
            for (let end = frameEnd(buffer); end >= 0; end = frameEnd(buffer)) {
                const frame = buffer.slice(0, end);
                buffer = buffer.slice(end).replace(/^(\r?\n){2}/, "");
                const event = parse<T>(frame);
                if (event !== undefined) yield event;
            }
        }

        // A stream that ends without its final blank line still has a frame.
        const last = parse<T>(buffer);
        if (last !== undefined) yield last;
    } finally {
        reader.releaseLock();
    }
}

function frameEnd(buffer: string): number {
    const unix = buffer.indexOf("\n\n");
    const windows = buffer.indexOf("\r\n\r\n");
    if (unix < 0) return windows;
    if (windows < 0) return unix;
    return Math.min(unix, windows);
}

/** Concatenates the frame's `data:` lines, per the SSE spec, and parses them. */
function parse<T>(frame: string): T | undefined {
    const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");

    // Cartesia closes the stream with a bare `[DONE]`, which is not JSON.
    if (!data || data === "[DONE]") return undefined;

    try {
        return JSON.parse(data) as T;
    } catch {
        // A malformed frame is not worth failing a stream of audio over.
        return undefined;
    }
}
