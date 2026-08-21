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
    const done = (call: OperationCall, started: number, detail = "") =>
        logger.debug(`${call.provider}.${call.operation} ok in ${Date.now() - started}ms${detail}`);

    const failed = (call: OperationCall, started: number, error: unknown) => {
        logger.error(
            `${call.provider}.${call.operation} failed after ${Date.now() - started}ms: ${String(error)}`,
        );
        return error;
    };

    return {
        name: "log",

        async speak(input, call, next) {
            const started = Date.now();
            logger.debug(
                `${call.provider}.speak ${input.text.length} chars, model=${input.model ?? "default"}, voice=${input.voice ?? "default"}`,
            );
            try {
                const result = await next(input);
                done(call, started, `, ${result.audio.length} bytes ${result.format.container}`);
                return result;
            } catch (error) {
                throw failed(call, started, error);
            }
        },

        speakStream(input, call, next) {
            logger.debug(
                `${call.provider}.speakStream ${input.text.length} chars, model=${input.model ?? "default"}, voice=${input.voice ?? "default"}`,
            );
            return next(input);
        },

        async transcribe(input, call, next) {
            const started = Date.now();
            logger.debug(
                `${call.provider}.transcribe model=${input.model ?? "default"}, language=${input.language ?? "auto"}`,
            );
            try {
                const result = await next(input);
                done(call, started, `, ${result.text.length} chars`);
                return result;
            } catch (error) {
                throw failed(call, started, error);
            }
        },

        async openTTSSession(input, call, next) {
            const started = Date.now();
            try {
                const session = await next(input);
                done(call, started);
                return session;
            } catch (error) {
                throw failed(call, started, error);
            }
        },

        async openSTTSession(input, call, next) {
            const started = Date.now();
            try {
                const session = await next(input);
                done(call, started);
                return session;
            } catch (error) {
                throw failed(call, started, error);
            }
        },

        async listVoices(call, next) {
            const started = Date.now();
            try {
                const voices = await next();
                done(call, started, `, ${voices.length} voices`);
                return voices;
            } catch (error) {
                throw failed(call, started, error);
            }
        },
    };
}
