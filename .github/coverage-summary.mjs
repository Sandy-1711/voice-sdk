// Renders each package's coverage as one markdown table, for $GITHUB_STEP_SUMMARY.
import { readFileSync } from "node:fs";

const packages = ["packages/core", "providers/cartesia", "providers/deepgram", "providers/elevenlabs"];

const rows = packages.flatMap((dir) => {
    let total;
    try {
        ({ total } = JSON.parse(readFileSync(`${dir}/coverage/coverage-summary.json`, "utf8")));
    } catch {
        return [];
    }
    const pct = (key) => `${total[key].pct}%`;
    return [
        `| \`${dir}\` | ${pct("statements")} | ${pct("branches")} | ${pct("functions")} | ${pct("lines")} |`,
    ];
});

if (rows.length === 0) {
    console.log("## Coverage\n\nNo coverage reports were produced.");
} else {
    console.log("## Coverage\n");
    console.log("| Package | Statements | Branches | Functions | Lines |");
    console.log("| --- | --- | --- | --- | --- |");
    console.log(rows.join("\n"));
}
