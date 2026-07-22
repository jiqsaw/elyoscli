// Terminal markdown rendering. Trade-off (accepted): the answer streams as raw
// markdown first, then the whole turn is re-rendered formatted once complete.

import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal() as Parameters<typeof marked.use>[0]);

export function renderMarkdown(text: string): string {
  return (marked.parse(text) as string).trimEnd() + "\n";
}

// Replaces the raw streamed turn output with the formatted version.
// `rawPrinted` is everything written since (and including) the "Assistant: " prefix,
// used to compute how many terminal lines to erase (accounting for line wrapping).
export function rerenderTurn(rawPrinted: string, answer: string): void {
  const cols = process.stdout.columns || 80;
  const contentLines = rawPrinted
    .replace(/\n$/, "")
    .split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / cols)), 0);
  process.stdout.write(`\x1b[${contentLines}A\r\x1b[0J`);
  process.stdout.write("Assistant:\n" + renderMarkdown(answer));
}
