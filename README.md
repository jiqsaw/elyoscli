# elyos-cli

A command-line chat app that streams LLM responses in real time, with tool calling against a weather API and a research API. See [SPECS.md](SPECS.md) for the full task description.

## Prerequisites

- Node.js ≥ 20.6 (built on v23) — needed for the `--env-file` flag

## Setup

```bash
npm install
```

Create a `.env` file in the project root with these variables (never commit it — it's gitignored):

```
ANTHROPIC_API_KEY=...
ELYOS_API_KEY=...
ELYOS_API_URL_WEATHER=...
ELYOS_API_URL_RESEARCH=...
```

## Run

```bash
npm run dev
```

Type a message at the `You:` prompt. Quit with `quit`, `exit`, `q`, or Ctrl+D.

## Type-check

```bash
npm run typecheck
```
