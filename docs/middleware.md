# Middleware

Why this SDK has two middleware layers, what belongs in each, and the ordering
rules that make them correct.

**In plain words:** every provider needs the same four things around its network
calls — retry, deadlines, logging, and a way to not hammer the API. Writing that
once per provider means writing it four times and getting it slightly wrong four
different ways. This is the shared version.

---

## Why now

`providers/deepgram/src/internal/http.ts` already hand-rolls retry, backoff and
a request deadline. When ElevenLabs drops its generated SDK, it needs the same
logic. When Cartesia drops its own, that is a third copy. Three copies of retry
policy is three places for a bug to hide.

The generated ElevenLabs client is what forced the issue: 19,963 files and
22.4 MB unpacked to reach six endpoints. It ships the whole product surface —
agents, dubbing, studio, workspace — and on Windows that many hardlinks is an
install that crawls or dies outright. For comparison, `@cartesia/cartesia-js` is
912 files and `ws` is 19.

What that SDK actually did for us was one file, `requestWithRetries.js`: retry
on 408/429/5xx, honour `Retry-After` and `X-RateLimit-Reset`, back off
exponentially with jitter. That is the bar this layer has to clear, and it does
— it also retries network errors, which the generated client never did.

---

## The two layers

They are not the same thing, and conflating them is how you ship a bug.

|              | **Transport**                     | **Operation**                      |
| ------------ | --------------------------------- | ---------------------------------- |
| Sees         | one HTTP request → one `Response` | `speak(input)` → `SpeakResult`     |
| Lives in     | `core/src/http/`                  | `core/src/middleware.ts`           |
| Applied by   | the provider, in its constructor  | the `Voice` wrapper                |
| Belongs here | retry, timeout, rate limit, auth  | logging, metrics, tracing, caching |

**Retry only works at the transport layer.** By the time an operation-level
middleware could decide to retry `speakStream`, the caller may already have
consumed three chunks of audio; running it again emits those bytes twice. The
transport layer decides on `response.status`, before a single byte of body has
been handed out, which is the only point where retrying is safe.

**Semantic logging only works at the operation layer.** A transport middleware
sees `POST /v1/text-to-speech/{id}`. It cannot see that you asked for 4,000
characters in `eleven_multilingual_v2`, which is the thing worth putting on a
metric.

A provider is usable with neither, either, or both.

---

## Transport layer

```ts
type HttpHandler    = (request: HttpRequest) => Promise<Response>;
type HttpMiddleware = (next: HttpHandler) => HttpHandler;
```

The standard onion. `compose([a, b, c])` puts `a` outermost, so it is the first
to see the request and the last to see the response.

`HttpRequest` carries a `meta` field that is never sent on the wire:

```ts
interface RequestMeta {
    provider: string;    // "elevenlabs"
    operation: string;   // "speak"
    attempt: number;     // 0 on the first try; retry increments it
    stream?: boolean;    // the body is consumed incrementally
    retries?: number;    // per-call override from RequestContext
    timeout?: number;    // per-call override from RequestContext
}
```

`retries` and `timeout` ride on `meta` so a per-call `RequestContext` still wins
over the provider's defaults, exactly as it did before this layer existed. Each
middleware reads `meta.x ?? its own option ?? the built-in default`.

### The default chain

```
logging → retry → rateLimit → timeout → fetch
```

Every position in that order is load-bearing:

- **`logging` outermost** so one log line covers the whole logical request,
  retries included, and reports the total wall time the caller actually waited.
- **`retry` outside `rateLimit`** so a request that is backing off is not
  holding a concurrency slot hostage while it sleeps.
- **`rateLimit` outside `timeout`** so each attempt independently acquires a
  slot. A retry storm is exactly what you want the limiter to gate.
- **`timeout` innermost** so every attempt gets a fresh deadline. A 30 s
  timeout means 30 s _per attempt_, not 30 s shared across three of them.

### What `timeout` actually bounds

**Time to headers, not time to the last byte.** Once the response line and
headers arrive, the timer is disarmed and the body streams without a deadline.

This is deliberate. A `speakStream` response is open for as long as the audio
takes to generate, and a deadline that outlives the headers would abort it
mid-body — which is precisely the bug the generated ElevenLabs client had, since
it handed `timeoutInSeconds` straight to `stream()`. A slow download is not a
failed request.

If you want a budget over the whole operation, body included, pass an
`AbortSignal` on the `RequestContext`. That is what a signal is for, and it
survives every layer untouched.

### What `retry` does and does not do

Retries on `408`, `429`, any `5xx`, and on thrown network errors. Does **not**
retry when:

- the caller's own `AbortSignal` fired — that is an answer, not a failure;
- the body is a `ReadableStream`, because a stream cannot be re-sent.

Delay comes from `Retry-After` first (seconds or HTTP-date), then
`X-RateLimit-Reset`, then exponential backoff with jitter, capped at 60 s.

A non-retryable failure is **returned, not thrown**. Turning a 400 into an error
needs the provider's own knowledge of its error envelope — Deepgram's
`{ err_code, err_msg }` and ElevenLabs' `{ detail }` do not look alike. The
transport hands back the `Response`; mapping it stays in the provider where the
knowledge is.

---

## Operation layer

Per-method optional hooks on the `Voice` wrapper:

```ts
const voice = new Voice({
    provider,
    middleware: [{
        async speak(input, call, next) {
            const started = performance.now();
            const result = await next(input);
            metrics.record(call.provider, input.text.length, performance.now() - started);
            return result;
        },
    }],
});
```

Every hook is optional; a middleware that only defines `speak` leaves the other
five operations untouched. `next` takes the input, so a middleware can rewrite
it on the way down.

`speakStream` is the odd one: it returns an `AudioStream` synchronously rather
than a promise, so its hook is synchronous too. Wrapping the iteration is the
caller's job if they want per-chunk behaviour.

---

## Redaction

`logging` strips any query parameter whose name looks like a credential
(`key`, `token`, `secret`, `auth`, `password`) before a URL reaches the log.
Headers are never logged at all — that is where every provider we ship puts its
API key.

---

## What is not here

**WebSocket middleware.** Reconnecting a duplex session is not "run the request
again": it means replaying a handshake and whatever text or audio was in flight,
and the right policy differs per provider. The sessions stay hand-written. Note
that both ElevenLabs realtime sessions were already raw `ws` before any of this,
so dropping the SDK never touched them.

**A body deadline.** See above — `context.signal` covers it, and a timer that
outlives the headers breaks streaming.
