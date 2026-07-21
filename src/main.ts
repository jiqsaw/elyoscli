import readline from "node:readline/promises";

// Fails fast if .env wasn't loaded (run via `npm run dev`). Only names are ever printed.
function requireEnv(names: string[]): void {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Define them in .env and run with: npm run dev");
    process.exit(1);
  }
}

type Message = { role: "user" | "assistant"; content: string };

// Placeholder for the core streaming logic (LLM call + tool handling).
async function* streamChat(userInput: string, history: Message[]): AsyncGenerator<string> {
  yield `(stub) You said: "${userInput}". Streaming logic not implemented yet.`;
}

async function main(): Promise<void> {
  requireEnv(["ANTHROPIC_API_KEY", "ELYOS_API_KEY", "ELYOS_API_URL_WEATHER", "ELYOS_API_URL_RESEARCH"]);

  const history: Message[] = [];
  // Async iteration (not rl.question) so lines arriving mid-response are queued, not dropped,
  // and EOF (Ctrl+D / end of piped input) cleanly ends the loop.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "You: " });

  console.log("elyos-cli — type a message, or quit/exit/q to leave.");
  rl.prompt();
  for await (const line of rl) {
    const userInput = line.trim();
    if (["quit", "exit", "q"].includes(userInput.toLowerCase())) break;

    if (userInput !== "") {
      process.stdout.write("Assistant: ");
      for await (const chunk of streamChat(userInput, history)) {
        process.stdout.write(chunk);
      }
      process.stdout.write("\n");
    }
    rl.prompt();
  }

  rl.close();
  console.log("Bye.");
}

main();
