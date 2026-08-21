import type { AudioStream } from "./audio";
import type { Logger } from "./logger";
import type { VoiceInfo } from "./provider";
import type { RealtimeSTTInput, RealtimeTTSInput, STTSession, TTSSession } from "./realtime";
import type { RequestContext, SpeakInput, SpeakResult, TranscribeInput, TranscriptResult } from "./types";

export type OperationName =
    | "speak"
    | "speakStream"
    | "transcribe"
    | "openTTSSession"
    | "openSTTSession"
    | "listVoices";

/** What is being called, alongside the input the hook already receives. */
export interface OperationCall {
    readonly provider: string;
    readonly operation: OperationName;
    /** Absent on the two operations that take no `RequestContext`. */
    readonly context?: RequestContext;
}

/**
 * Wraps whole operations rather than individual HTTP requests, so a hook can
 * see which voice and model were asked for — the things worth putting on a
 * metric, and the things a transport middleware cannot know.
 *
 * Every hook is optional; one that defines only `speak` leaves the rest alone.
 * `next` takes the input, so a hook may rewrite it on the way down.
 *
 * Retry does not belong here. By the time this layer could re-run
 * `speakStream`, the caller may already hold audio chunks, and running it again
 * would emit them twice — use the transport `retry` middleware instead.
 */
export interface VoiceMiddleware {
    /** Shown in the built-in logger's output. */
    name?: string;

    speak?(
        input: SpeakInput,
        call: OperationCall,
        next: (input: SpeakInput) => Promise<SpeakResult>,
    ): Promise<SpeakResult>;

    /** Synchronous, because `speakStream` hands back a stream rather than a promise. */
    speakStream?(
        input: SpeakInput,
        call: OperationCall,
        next: (input: SpeakInput) => AudioStream,
    ): AudioStream;

    transcribe?(
        input: TranscribeInput,
        call: OperationCall,
        next: (input: TranscribeInput) => Promise<TranscriptResult>,
    ): Promise<TranscriptResult>;

    openTTSSession?(
        input: RealtimeTTSInput | undefined,
        call: OperationCall,
        next: (input?: RealtimeTTSInput) => Promise<TTSSession>,
    ): Promise<TTSSession>;

    openSTTSession?(
        input: RealtimeSTTInput | undefined,
        call: OperationCall,
        next: (input?: RealtimeSTTInput) => Promise<STTSession>,
    ): Promise<STTSession>;

    listVoices?(call: OperationCall, next: () => Promise<VoiceInfo[]>): Promise<VoiceInfo[]>;
}

type Hook<TInput, TResult> = (
    input: TInput,
    call: OperationCall,
    next: (input: TInput) => TResult,
) => TResult;

/**
 * Folds the hooks into one function. Generic over the result so the same fold
 * serves the async operations and the synchronous `speakStream`.
 *
 * The first middleware ends up outermost, matching the transport chain.
 */
export function chain<TInput, TResult>(
    middleware: readonly VoiceMiddleware[],
    pick: (entry: VoiceMiddleware) => Hook<TInput, TResult> | undefined,
    call: OperationCall,
    base: (input: TInput) => TResult,
): (input: TInput) => TResult {
    return middleware.reduceRight<(input: TInput) => TResult>((next, entry) => {
        const hook = pick(entry);
        if (!hook) return next;
        return (input) => hook.call(entry, input, call, next);
    }, base);
}

/** `listVoices` takes no input, so it folds on its own. */
export function chainListVoices(
    middleware: readonly VoiceMiddleware[],
    call: OperationCall,
    base: () => Promise<VoiceInfo[]>,
): () => Promise<VoiceInfo[]> {
    return middleware.reduceRight<() => Promise<VoiceInfo[]>>((next, entry) => {
        const hook = entry.listVoices?.bind(entry);
        if (!hook) return next;
        return () => hook(call, next);
    }, base);
}

/**
 * The built-in `VoiceOptions.logger` hook. Reports what was asked for, not just
 * that a request happened — the character count and model are the reason this
 * sits at the operation layer rather than the transport one.
 */
export function logOperations(logger: Logger): VoiceMiddleware {
    const failed = (call: OperationCall, started: number, error: unknown): void => {
        logger.error(
            `${call.provider}.${call.operation} failed after ${Date.now() - started}ms: ${String(error)}`,
        );
    };

    /** Times an operation and reports its outcome exactly once. */
    const timed = async <T>(
        call: OperationCall,
        run: () => Promise<T>,
        detail?: (result: T) => string,
    ): Promise<T> => {
        const started = Date.now();
        try {
            const result = await run();
            const suffix = detail ? detail(result) : "";
            logger.debug(`${call.provider}.${call.operation} ok in ${Date.now() - started}ms${suffix}`);
            return result;
        } catch (error) {
            failed(call, started, error);
            throw error;
        }
    };

    const synthesis = (call: OperationCall, input: SpeakInput) =>
        `${call.provider}.${call.operation} ${input.text.length} chars, model=${input.model ?? "default"}, voice=${input.voice ?? "default"}`;

    return {
        name: "log",

        speak(input, call, next) {
            logger.debug(synthesis(call, input));
            return timed(
                call,
                () => next(input),
                (r) => `, ${r.audio.length} bytes ${r.format.container}`,
            );
        },

        speakStream(input, call, next) {
            logger.debug(synthesis(call, input));
            // Returns a stream rather than a promise, so there is no duration to
            // report — but a provider that throws while opening it still counts
            // as a failure.
            const started = Date.now();
            try {
                return next(input);
            } catch (error) {
                failed(call, started, error);
                throw error;
            }
        },

        transcribe(input, call, next) {
            logger.debug(
                `${call.provider}.transcribe model=${input.model ?? "default"}, language=${input.language ?? "auto"}`,
            );
            return timed(
                call,
                () => next(input),
                (r) => `, ${r.text.length} chars`,
            );
        },

        openTTSSession(input, call, next) {
            return timed(call, () => next(input));
        },

        openSTTSession(input, call, next) {
            return timed(call, () => next(input));
        },

        listVoices(call, next) {
            return timed(
                call,
                () => next(),
                (v) => `, ${v.length} voices`,
            );
        },
    };
}
