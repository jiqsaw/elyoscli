import readline from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { streamChat } from "./llm.ts";
import ora from "ora";
import { isCancellation, reportLlmError, requireEnv } from "./helpers.ts";
import { rerenderTurn } from "./markdown.ts";

async function main(): Promise<void> {
  requireEnv(["ANTHROPIC_API_KEY", "ELYOS_API_KEY", "ELYOS_API_URL_WEATHER", "ELYOS_API_URL_RESEARCH"]);

  const history: Anthropic.MessageParam[] = [];
  // Async iteration (not rl.question) so lines arriving mid-response are queued, not dropped,
  // and EOF (Ctrl+D / end of piped input) cleanly ends the loop.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "You: " });

  // Ctrl+C: cancel the in-flight turn if there is one, otherwise exit.
  // On a TTY readline owns stdin (raw mode) and emits "SIGINT" on the interface;
  // with piped input the signal arrives on the process instead — handle both.
  let activeTurn: AbortController | null = null;
  const onSigint = () => {
    if (activeTurn) {
      activeTurn.abort(new DOMException("cancelled by user", "AbortError"));
    } else {
      rl.close();
      console.log("\nBye.");
      process.exit(0);
    }
  };
  rl.on("SIGINT", onSigint);
  process.on("SIGINT", onSigint);

  console.log("elyos-cli — type a message, or quit/exit/q to leave.");
  rl.prompt();
  for await (const line of rl) {
    const userInput = line.trim();
    if (["quit", "exit", "q"].includes(userInput.toLowerCase())) break;

    if (userInput !== "") {
      const turnStart = history.length;
      activeTurn = new AbortController();
      // ora handles all pending states: spins while the LLM or a tool is working,
      // clears itself when output arrives. Falls back to plain text lines when
      // stdout isn't a TTY. Spinner lines self-erase, so they stay out of rawParts.
      // A TTY reporting zero width (some ptys) breaks ora's line clearing — fall
      // back to plain text there too.
      const brokenTty = process.stdout.isTTY && !process.stdout.columns;
      const spinner = ora({ text: "Thinking…", ...(brokenTty ? { isEnabled: false } : {}) }).start();
      try {
        const rawParts: string[] = [];
        const write = (s: string) => {
          rawParts.push(s);
          process.stdout.write(s);
        };
        let answer = "";
        let prefixWritten = false;
        // The first status ("Calling X…") passes quickly; the cancel hint only
        // makes sense from the second one on (the actual API call / long waits).
        let statusCount = 0;
        const onStatus = (msg: string) => {
          spinner.stop();
          // Keep text segments separated when a tool call interrupts the answer.
          if (answer !== "" && !answer.endsWith("\n\n")) {
            answer += "\n\n";
            write("\n\n");
          }
          spinner.start(`${msg}${++statusCount > 1 ? " (Ctrl+C to cancel)" : ""}`);
        };
        for await (const chunk of streamChat(userInput, history, activeTurn.signal, onStatus)) {
          spinner.stop();
          if (!prefixWritten) {
            write("Assistant: ");
            prefixWritten = true;
          }
          answer += chunk;
          write(chunk);
        }
        spinner.stop();
        if (prefixWritten) write("\n");
        // Re-render the finished answer as formatted markdown (TTY only —
        // piped output keeps the raw stream).
        if (process.stdout.isTTY && answer.trim() !== "") {
          rerenderTurn(rawParts.join(""), answer);
        }
      } catch (err) {
        spinner.stop();
        history.length = turnStart; // roll back the failed turn so the next one starts clean
        if (isCancellation(err)) console.log("\n[Cancelled — back at the prompt]");
        else reportLlmError(err);
      } finally {
        activeTurn = null;
      }
    }
    rl.prompt();
  }

  rl.close();
  console.log("Bye.");
}

main();
