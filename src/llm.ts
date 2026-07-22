// LLM layer: streaming chat with tool calling via a manual agentic loop
// (deliberately not the SDK's beta Tool Runner — see TECH_STACK.md).

import Anthropic from "@anthropic-ai/sdk";
import { getWeather, researchTopic } from "./api.ts";
import { LLM_MAX_TOKENS, LLM_MODEL } from "./constants.ts";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const SYSTEM_PROMPT =
  "You are a helpful assistant in a terminal chat. Keep answers concise. " +
  "Use the tools when the user asks about weather or wants a topic researched.";

// SPECS.md's tool template is OpenAI-format; converted here to Anthropic's flat shape.
// Tool names match the api.ts methods they invoke.
const tools: Anthropic.Tool[] = [
  {
    name: "getWeather",
    description: "Get current weather for a city. Fast response.",
    input_schema: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name, e.g. London, Tokyo" },
      },
      required: ["location"],
    },
  },
  {
    name: "researchTopic",
    description:
      "Research a topic in depth. Takes 3-8 seconds. Use for questions requiring detailed research.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to research, e.g. 'solar energy', 'climate change'" },
      },
      required: ["topic"],
    },
  },
];

type OnStatus = (msg: string) => void;

async function runTool(
  block: Anthropic.ToolUseBlock,
  signal?: AbortSignal,
  onStatus?: OnStatus,
): Promise<Anthropic.ToolResultBlockParam> {
  const input = block.input as Record<string, string>;
  try {
    let result: unknown;
    if (block.name === "getWeather") {
      onStatus?.(`Getting weather for ${input.location}…`);
      result = await getWeather(input.location ?? "", signal, onStatus);
    } else if (block.name === "researchTopic") {
      onStatus?.(`Researching ${input.topic}…`);
      result = await researchTopic(input.topic ?? "", signal, onStatus);
    } else {
      throw new Error(`Unknown tool: ${block.name}`);
    }
    return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) };
  } catch (err) {
    if (signal?.aborted) throw err; // cancellation is handled by the caller, not fed to the LLM
    // Tool failures go back to the LLM so it can explain them to the user.
    const message = err instanceof Error ? err.message : String(err);
    return { type: "tool_result", tool_use_id: block.id, content: message, is_error: true };
  }
}

// Streams one user turn: yields printable text chunks, runs tool round trips,
// and appends all turns (user, assistant, tool results) to `history`.
export async function* streamChat(
  userInput: string,
  history: Anthropic.MessageParam[],
  signal?: AbortSignal,
  onStatus?: OnStatus,
): AsyncGenerator<string> {
  history.push({ role: "user", content: userInput });

  while (true) {
    const stream = client.messages.stream(
      {
        model: LLM_MODEL,
        max_tokens: LLM_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools,
        messages: history,
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        onStatus?.(`Calling ${event.content_block.name}…`);
      }
    }

    const message = await stream.finalMessage();
    history.push({ role: "assistant", content: message.content });

    if (message.stop_reason !== "tool_use") {
      if (message.stop_reason === "max_tokens") yield "\n[Response cut off: hit the token limit]";
      if (message.stop_reason === "refusal") yield "\n[The model declined to answer this request]";
      return;
    }

    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUses) {
      results.push(await runTool(block, signal, onStatus));
    }
    history.push({ role: "user", content: results });
  }
}
