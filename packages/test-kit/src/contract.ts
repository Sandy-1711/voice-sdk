import type { Alignment, STTEvent, TTSEvent, VoiceProvider } from "@swungstudent/voice";

/**
 * The invariant every provider owes the contract in core's provider.ts: a
 * capability flag is a promise that the matching method exists, and a false
 * flag is a promise that it does not. Shared so all providers are held to it.
 */
const METHODS: Record<string, string[]> = {
    tts: ["speak", "speakStream"],
    stt: ["transcribe"],
    realtimeTTS: ["openTTSSession"],
    realtimeSTT: ["openSTTSession"],
};

export function assertCapabilityInvariants(provider: VoiceProvider): void {
    check(
        typeof provider.name === "string" && provider.name.length > 0,
        "provider.name must be a non-empty string",
    );

    for (const [capability, methods] of Object.entries(METHODS)) {
        const enabled = provider.capabilities[capability as keyof typeof provider.capabilities];
        check(typeof enabled === "boolean", `capabilities.${capability} must be a boolean`);

        for (const method of methods) {
            const present = typeof (provider as unknown as Record<string, unknown>)[method] === "function";
            check(
                present === enabled,
                enabled
                    ? `"${provider.name}" claims ${capability} but has no ${method}()`
                    : `"${provider.name}" implements ${method}() but reports ${capability}: false`,
            );
        }
    }
}

/** Every event a TTS session emits has to be a legal member of core's union. */
export function assertTTSEvent(event: TTSEvent): void {
    switch (event.type) {
        case "audio":
            check(event.data instanceof Uint8Array, "audio.data must be a Uint8Array");
            checkOptionalNumber(event.offset, "audio.offset");
            break;
        case "timing":
            assertAlignment(event.alignment);
            break;
        case "flushed":
        case "cleared":
            check(
                event.id === undefined || typeof event.id === "string" || typeof event.id === "number",
                `${event.type}.id must be a string, a number or undefined`,
            );
            break;
        case "done":
            break;
        case "metadata":
            checkOptionalString(event.requestId, "metadata.requestId");
            checkOptionalString(event.model, "metadata.model");
            break;
        case "warning":
            check(typeof event.message === "string", "warning.message must be a string");
            checkOptionalString(event.code, "warning.code");
            break;
        default:
            throw new Error(`Unknown TTS event type: ${JSON.stringify((event as { type: unknown }).type)}`);
    }
}

/** Same for STT sessions, plus the finality and word-shape rules. */
export function assertSTTEvent(event: STTEvent): void {
    switch (event.type) {
        case "transcript":
            check(
                event.finality === "partial" || event.finality === "final" || event.finality === "turn_end",
                `transcript.finality must be partial | final | turn_end, got ${JSON.stringify(event.finality)}`,
            );
            check(typeof event.text === "string", "transcript.text must be a string");
            check(typeof event.delta === "string", "transcript.delta must be a string");
            check(
                Number.isInteger(event.turn) && event.turn >= 0,
                "transcript.turn must be a non-negative integer",
            );
            checkOptionalNumber(event.start, "transcript.start");
            checkOptionalNumber(event.end, "transcript.end");
            for (const word of event.words ?? []) {
                check(typeof word.text === "string", "word.text must be a string");
                check(typeof word.start === "number", "word.start must be a number");
                check(typeof word.end === "number", "word.end must be a number");
            }
            break;
        case "speech_started":
        case "speech_ended":
            checkOptionalNumber(event.at, `${event.type}.at`);
            break;
        case "metadata":
            checkOptionalString(event.requestId, "metadata.requestId");
            checkOptionalString(event.model, "metadata.model");
            break;
        case "warning":
            check(typeof event.message === "string", "warning.message must be a string");
            checkOptionalString(event.code, "warning.code");
            break;
        default:
            throw new Error(`Unknown STT event type: ${JSON.stringify((event as { type: unknown }).type)}`);
    }
}

/**
 * A turn number never goes backwards, and only advances after a turn_end — the
 * rule every provider's finality mapping has to honour.
 */
export function assertTurnSequence(events: STTEvent[]): void {
    let turn = 0;
    let ended = false;

    for (const event of events) {
        if (event.type !== "transcript") continue;
        check(
            event.turn === turn || (ended && event.turn === turn + 1),
            `turn jumped from ${turn} to ${event.turn}${ended ? "" : " without a turn_end"}`,
        );
        if (event.turn !== turn) ended = false;
        turn = event.turn;
        if (event.finality === "turn_end") ended = true;
    }
}

function assertAlignment(alignment: Alignment): void {
    check(
        alignment.unit === "word" || alignment.unit === "character" || alignment.unit === "phoneme",
        `alignment.unit must be word | character | phoneme, got ${JSON.stringify(alignment.unit)}`,
    );
    check(Array.isArray(alignment.spans), "alignment.spans must be an array");
    for (const span of alignment.spans) {
        check(typeof span.text === "string", "span.text must be a string");
        check(
            typeof span.start === "number" && typeof span.end === "number",
            "span.start/end must be numbers",
        );
        check(
            span.end >= span.start,
            `span "${span.text}" ends (${span.end}) before it starts (${span.start})`,
        );
    }
}

function checkOptionalNumber(value: unknown, label: string): void {
    check(value === undefined || typeof value === "number", `${label} must be a number or undefined`);
}

function checkOptionalString(value: unknown, label: string): void {
    check(value === undefined || typeof value === "string", `${label} must be a string or undefined`);
}

function check(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(`Contract violation: ${message}`);
}
