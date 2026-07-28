/**
 * Derives whichever of cumulative text / delta a provider does not send, so
 * STTTranscriptEvent always carries both. Providers send deltas, per-segment
 * text, or the whole turn re-sent on every event.
 */
export class TurnTextTracker {
    #turn = 0;
    #committed = "";
    #current = "";

    get turn(): number {
        return this.#turn;
    }

    /** For providers that send only what is new. */
    fromDelta(delta: string): { text: string; delta: string; turn: number } {
        this.#current += delta;
        return { text: this.#current, delta, turn: this.#turn };
    }

    /** For providers that re-send the whole turn each time. */
    fromCumulative(text: string): { text: string; delta: string; turn: number } {
        const delta = text.startsWith(this.#current) ? text.slice(this.#current.length) : text;
        this.#current = text;
        return { text, delta, turn: this.#turn };
    }

    /** For providers whose text is scoped to a segment, not the whole turn. */
    fromSegment(text: string): { text: string; delta: string; turn: number } {
        return this.fromCumulative(this.#committed + text);
    }

    /** The turn continues, but everything so far is stable. */
    commitSegment(): void {
        this.#committed = this.#current;
    }

    endTurn(): void {
        this.#turn += 1;
        this.#committed = "";
        this.#current = "";
    }
}
