import { describe, expect, it } from "vitest";
import { TurnTextTracker } from "../src/index";

describe("TurnTextTracker", () => {
    it("starts on turn zero with nothing said", () => {
        const tracker = new TurnTextTracker();

        expect(tracker.turn).toBe(0);
        expect(tracker.text).toBe("");
    });

    describe("fromDelta - providers that send only what is new", () => {
        it("accumulates the turn text and echoes the delta back", () => {
            const tracker = new TurnTextTracker();

            expect(tracker.fromDelta("Hello")).toEqual({ text: "Hello", delta: "Hello", turn: 0 });
            expect(tracker.fromDelta(" there")).toEqual({ text: "Hello there", delta: " there", turn: 0 });
            expect(tracker.text).toBe("Hello there");
        });
    });

    describe("fromCumulative - providers that re-send the whole turn", () => {
        it("derives the delta from the previous text", () => {
            const tracker = new TurnTextTracker();

            expect(tracker.fromCumulative("Hello")).toEqual({ text: "Hello", delta: "Hello", turn: 0 });
            expect(tracker.fromCumulative("Hello there")).toEqual({
                text: "Hello there",
                delta: " there",
                turn: 0,
            });
        });

        it("falls back to the whole text when a revision is not a continuation", () => {
            const tracker = new TurnTextTracker();
            tracker.fromCumulative("Hello there");

            // Interim results get rewritten, not just extended.
            expect(tracker.fromCumulative("Hello Dave")).toEqual({
                text: "Hello Dave",
                delta: "Hello Dave",
                turn: 0,
            });
            expect(tracker.text).toBe("Hello Dave");
        });

        it("reports an empty delta when nothing changed", () => {
            const tracker = new TurnTextTracker();
            tracker.fromCumulative("Hello");

            expect(tracker.fromCumulative("Hello")).toEqual({ text: "Hello", delta: "", turn: 0 });
        });
    });

    describe("fromSegment - providers whose text covers one segment", () => {
        it("prefixes the committed text so the turn stays cumulative", () => {
            const tracker = new TurnTextTracker();

            tracker.fromSegment("Hello there.");
            tracker.commitSegment();

            expect(tracker.fromSegment(" How are you?")).toEqual({
                text: "Hello there. How are you?",
                delta: " How are you?",
                turn: 0,
            });
        });

        it("revises within a segment without disturbing what was committed", () => {
            const tracker = new TurnTextTracker();
            tracker.fromSegment("Hello there.");
            tracker.commitSegment();

            tracker.fromSegment(" How are");
            const revised = tracker.fromSegment(" How is it going?");

            expect(revised.text).toBe("Hello there. How is it going?");
            expect(tracker.text).toBe("Hello there. How is it going?");
        });
    });

    describe("endTurn", () => {
        it("advances the counter and clears the text", () => {
            const tracker = new TurnTextTracker();
            tracker.fromDelta("first turn");

            tracker.endTurn();

            expect(tracker.turn).toBe(1);
            expect(tracker.text).toBe("");
            expect(tracker.fromDelta("second")).toEqual({ text: "second", delta: "second", turn: 1 });
        });

        it("clears committed segments, so the next turn does not inherit them", () => {
            const tracker = new TurnTextTracker();
            tracker.fromSegment("first turn.");
            tracker.commitSegment();

            tracker.endTurn();

            expect(tracker.fromSegment("second turn.")).toEqual({
                text: "second turn.",
                delta: "second turn.",
                turn: 1,
            });
        });
    });
});
