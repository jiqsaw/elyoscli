import readline from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { streamChat } from "./llm.ts";
import { rerenderTurn } from "./markdown.ts";

// Fails fast if .env wasn't loaded (run via `npm run dev`). Only names are ever printed.
function requireEnv(names: string[]): void {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Define them in .env and run with: npm run dev");
    process.exit(1);
  }
}

function isCancellation(err: unknown): boolean {
  return err instanceof Anthropic.APIUserAbortError || (err instanceof Error && err.name === "AbortError");
}

function reportLlmError(err: unknown): void {
  if (err instanceof Anthropic.AuthenticationError) console.error("\nLLM auth failed — check ANTHROPIC_API_KEY.");
  else if (err instanceof Anthropic.RateLimitError) console.error("\nLLM rate limited — try again shortly.");
  else if (err instanceof Anthropic.APIConnectionError) console.error("\nNetwork error reaching Anthropic.");
  else if (err instanceof Anthropic.APIError) console.error(`\nLLM error (${err.status}): ${err.message}`);
  else console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
}

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
      try {
        const rawParts: string[] = [];
        const write = (s: string) => {
          rawParts.push(s);
          process.stdout.write(s);
        };
        write("Assistant: ");
        const onStatus = (msg: string) => write(`\n  [${msg}] (Ctrl+C to cancel)\n`);
        let answer = "";
        for await (const chunk of streamChat(userInput, history, activeTurn.signal, onStatus)) {
          answer += chunk;
          write(chunk);
        }
        write("\n");
        // Re-render the finished answer as formatted markdown (TTY only —
        // piped output keeps the raw stream).
        if (process.stdout.isTTY && answer.trim() !== "") {
          rerenderTurn(rawParts.join(""), answer);
        }
      } catch (err) {
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
