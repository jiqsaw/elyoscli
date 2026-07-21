# Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **LLM:** Anthropic's official SDK (`@anthropic-ai/sdk`) — streaming responses + tool calling
- **Database:** None
- **Tests:** No unit test suite
- **Configuration:** Environment variables (API keys, URLs) live in `.env`.
  - `.env` is never committed (see `.gitignore`).
  - Its values are never read back or printed in conversation/output.

## Dependency policy

Only dependencies implied by the stack above may be added without discussion.
Anything else (spinner libs, HTTP clients, dotenv loaders, etc.) requires asking first.
