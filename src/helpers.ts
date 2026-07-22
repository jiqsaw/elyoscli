import Anthropic from "@anthropic-ai/sdk";

// Fails fast if .env wasn't loaded (run via `npm run dev`). Only names are ever printed.
export function requireEnv(names: string[]): void {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Define them in .env and run with: npm run dev");
    process.exit(1);
  }
}

export function isCancellation(err: unknown): boolean {
  return err instanceof Anthropic.APIUserAbortError || (err instanceof Error && err.name === "AbortError");
}

export function reportLlmError(err: unknown): void {
  if (err instanceof Anthropic.AuthenticationError) console.error("\nLLM auth failed — check ANTHROPIC_API_KEY.");
  else if (err instanceof Anthropic.RateLimitError) console.error("\nLLM rate limited — try again shortly.");
  else if (err instanceof Anthropic.APIConnectionError) console.error("\nNetwork error reaching Anthropic.");
  else if (err instanceof Anthropic.APIError) console.error(`\nLLM error (${err.status}): ${err.message}`);
  else console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
}
