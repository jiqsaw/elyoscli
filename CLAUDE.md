# elyos-cli

A command-line chat app that streams LLM responses to the terminal in real time. The LLM can call two tools — a fast weather API (~200ms) and a slow research API (3–8s) — via HTTP endpoints authenticated with an `X-API-Key` header. The app shows a pending state during slow tool calls, lets the user cancel long-running operations (Ctrl+C), maintains conversation history across turns, and handles the APIs' undocumented quirks gracefully. Full requirements in `SPECS.md`.

## Tech stack

TypeScript + Node.js, Anthropic's official SDK for LLM calls. No database, no unit tests. Secrets in `.env` (never read/printed, never committed). Details in `TECH_STACK.md`.

## Workflow rules

- Never install a package without asking first.
- Never implement major logic without first showing the approach and getting approval.
- Build step by step, one module at a time: plan a module, get approval, implement, verify, commit.
- Keep this file short; update it only when something here changes.
- Before integrating any new external API, probe it first (script in `scripts/`, outside app code): repetition for latency/consistency, input variation, auth errors, and concurrency/rate limits. Record findings in `API_NOTES.md` (observation → how discovered → error case → handling plan) before writing integration code.
