// Elyos API client. Quirk handling based on probe findings in API_NOTES.md.

import { API_MAX_ATTEMPTS, API_TIMEOUT_MS, API_THROTTLE_WAIT_CAP_S } from "./constants.ts";
import type { ResearchData, WeatherCondition, WeatherData } from "./models.ts";

type OnStatus = (msg: string) => void;

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });
}

// F4: errors arrive as {error}, {detail: string}, or {detail: [FastAPI validation]}.
function errorMessage(status: number, body: unknown, rawText: string): string {
  if (typeof body === "object" && body !== null) {
    const b = body as Record<string, unknown>;
    if (typeof b.error === "string") return b.error;
    if (typeof b.detail === "string") return b.detail;
    if (Array.isArray(b.detail)) return b.detail.map((d) => d?.msg ?? JSON.stringify(d)).join("; ");
  }
  const excerpt = rawText.trim().slice(0, 200);
  return `API error (HTTP ${status})${excerpt ? `: ${excerpt}` : ""}`;
}

async function apiGet(url: string, signal?: AbortSignal, onStatus?: OnStatus): Promise<unknown> {
  let lastError: Error = new Error("API request failed");

  for (let attempt = 1; attempt <= API_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      onStatus?.(`Retrying (${attempt}/${API_MAX_ATTEMPTS})…`);
      await abortableSleep(attempt === 2 ? 500 : 1000, signal);
    }
    let res: Response;
    let text: string;
    try {
      const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
      res = await fetch(url, {
        headers: { "X-API-Key": process.env.ELYOS_API_KEY! },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      text = await res.text();
    } catch (err) {
      if (signal?.aborted) throw signal.reason; // user cancellation — not an API failure
      // Timeouts and network errors are transient — retry.
      lastError =
        err instanceof Error && err.name === "TimeoutError"
          ? new Error(`API timed out after ${API_TIMEOUT_MS / 1000}s`)
          : new Error("API unreachable (network error)", { cause: err });
      continue;
    }

    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {}

    if (res.status >= 500) {
      lastError = new Error(errorMessage(res.status, body, text));
      continue; // transient server error — retry
    }
    if (!res.ok) throw new Error(errorMessage(res.status, body, text)); // 4xx — deterministic, no retry

    // F1: rate limiting comes back as HTTP 200 with a throttle body.
    if (typeof body === "object" && body !== null && (body as any).status === "throttled") {
      const waitS = Math.min(Number((body as any).retry_after_seconds) || 5, API_THROTTLE_WAIT_CAP_S);
      lastError = new Error("API rate limit exceeded. Try again shortly.");
      onStatus?.(`Rate limited, waiting ${waitS}s…`);
      await abortableSleep(waitS * 1000, signal);
      continue;
    }
    if (body === null) {
      lastError = new Error("API returned a non-JSON response");
      continue;
    }
    return body;
  }
  throw lastError;
}

export async function getWeather(location: string, signal?: AbortSignal, onStatus?: OnStatus): Promise<WeatherData> {
  if (!location.trim()) throw new Error("location is required"); // F6
  const url = `${process.env.ELYOS_API_URL_WEATHER}?location=${encodeURIComponent(location.trim())}`;
  const body = (await apiGet(url, signal, onStatus)) as Record<string, unknown>;
  // F2: same request returns either a flat condition or {conditions: [...]} — normalize to a list.
  const conditions = Array.isArray(body.conditions)
    ? (body.conditions as WeatherCondition[])
    : [{ temperature_c: body.temperature_c, condition: body.condition, humidity: body.humidity } as WeatherCondition];
  return { location: String(body.location ?? location), conditions };
}

export async function researchTopic(topic: string, signal?: AbortSignal, onStatus?: OnStatus): Promise<ResearchData> {
  if (!topic.trim()) throw new Error("topic is required"); // F6
  const url = `${process.env.ELYOS_API_URL_RESEARCH}?topic=${encodeURIComponent(topic.trim())}`;
  const body = (await apiGet(url, signal, onStatus)) as Record<string, unknown>;
  if (typeof body.summary !== "string") {
    throw new Error(`API returned an unexpected research response: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body as unknown as ResearchData;
}
