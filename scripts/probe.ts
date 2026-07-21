// Disposable API discovery probe — not part of the app.
// Run: npx tsx --env-file=.env scripts/probe.ts
// Raw per-request evidence: scripts/probe-results.ndjson (gitignored)

import { appendFileSync } from "node:fs";

const WEATHER_URL = process.env.ELYOS_API_URL_WEATHER!;
const RESEARCH_URL = process.env.ELYOS_API_URL_RESEARCH!;
const API_KEY = process.env.ELYOS_API_KEY!;
if (!WEATHER_URL || !RESEARCH_URL || !API_KEY) {
  console.error("Missing ELYOS_API_URL_WEATHER / ELYOS_API_URL_RESEARCH / ELYOS_API_KEY");
  process.exit(1);
}

const LOG_FILE = new URL("./probe-results.ndjson", import.meta.url).pathname;
const TIMEOUT_MS = 20_000;

interface ProbeResult {
  group: string;
  name: string;
  url: string; // key never appears in URLs
  method: string;
  status: number | null; // null = network error / timeout
  errorName?: string;
  latencyMs: number;
  contentType: string | null;
  headers: Record<string, string>;
  bodyText: string;
  json: unknown | null; // null if body isn't valid JSON
  shape: string; // structural signature of JSON body
  ts: string;
}

const results: ProbeResult[] = [];

// Structural signature: sorted key paths with value types, e.g. "temp:number|city:string"
function shapeOf(value: unknown, path = ""): string {
  if (value === null) return `${path}:null`;
  if (Array.isArray(value)) {
    const inner = value.length > 0 ? shapeOf(value[0], `${path}[]`) : `${path}[]:empty`;
    return inner;
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => shapeOf(v, path ? `${path}.${k}` : k))
      .sort()
      .join("|");
  }
  return `${path}:${typeof value}`;
}

async function probe(
  group: string,
  name: string,
  url: string,
  opts: { method?: string; noKey?: boolean; key?: string } = {},
): Promise<ProbeResult> {
  const headers: Record<string, string> = {};
  if (!opts.noKey) headers["X-API-Key"] = opts.key ?? API_KEY;

  const start = performance.now();
  let result: ProbeResult;
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const bodyText = await res.text();
    let json: unknown | null = null;
    try {
      json = JSON.parse(bodyText);
    } catch {}
    result = {
      group,
      name,
      url,
      method: opts.method ?? "GET",
      status: res.status,
      latencyMs: Math.round(performance.now() - start),
      contentType: res.headers.get("content-type"),
      headers: Object.fromEntries(res.headers.entries()),
      bodyText,
      json,
      shape: json !== null ? shapeOf(json) : "(not json)",
      ts: new Date().toISOString(),
    };
  } catch (err) {
    result = {
      group,
      name,
      url,
      method: opts.method ?? "GET",
      status: null,
      errorName: err instanceof Error ? err.name : String(err),
      latencyMs: Math.round(performance.now() - start),
      contentType: null,
      headers: {},
      bodyText: "",
      json: null,
      shape: "(no response)",
      ts: new Date().toISOString(),
    };
  }
  results.push(result);
  appendFileSync(LOG_FILE, JSON.stringify(result) + "\n");
  return result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const weatherUrl = (params: string) => `${WEATHER_URL}?${params}`;
const researchUrl = (params: string) => `${RESEARCH_URL}?${params}`;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function summarize(group: string): void {
  const rs = results.filter((r) => r.group === group);
  const statuses = new Map<string, number>();
  for (const r of rs) {
    const key = r.status === null ? `ERR(${r.errorName})` : String(r.status);
    statuses.set(key, (statuses.get(key) ?? 0) + 1);
  }
  const latencies = rs.filter((r) => r.status !== null).map((r) => r.latencyMs).sort((a, b) => a - b);
  const shapes = new Map<string, ProbeResult>();
  for (const r of rs) if (!shapes.has(r.shape)) shapes.set(r.shape, r);

  console.log(`\n=== ${group} (${rs.length} requests) ===`);
  console.log(`  statuses: ${[...statuses.entries()].map(([s, n]) => `${s}×${n}`).join("  ")}`);
  if (latencies.length > 0) {
    console.log(
      `  latency ms: p50=${percentile(latencies, 50)} p95=${percentile(latencies, 95)} max=${latencies[latencies.length - 1]}`,
    );
  }
  console.log(`  distinct body shapes: ${shapes.size}`);
  for (const [shape, sample] of shapes) {
    console.log(`   - [${sample.name}] status=${sample.status} shape: ${shape.slice(0, 160)}`);
    console.log(`     sample: ${sample.bodyText.slice(0, 300).replaceAll("\n", "\\n")}`);
  }
}

async function main() {
  console.log(`Probe run ${new Date().toISOString()} — logging to ${LOG_FILE}`);

  // --- Group A: repetition & shape consistency ---
  console.log("\nGroup A: repetition (weather ×25, research ×10)...");
  for (let i = 0; i < 25; i++) {
    await probe("A-weather-repeat", `london-${i}`, weatherUrl("location=London"));
    await sleep(150);
  }
  for (let i = 0; i < 10; i++) {
    const r = await probe("A-research-repeat", `solar-${i}`, researchUrl("topic=solar+energy"));
    console.log(`  research ${i}: status=${r.status ?? r.errorName} ${r.latencyMs}ms`);
    await sleep(150);
  }
  summarize("A-weather-repeat");
  summarize("A-research-repeat");

  // Value stability for identical input (compare full bodies among 200s)
  const londonBodies = new Set(
    results.filter((r) => r.group === "A-weather-repeat" && r.status === 200).map((r) => r.bodyText),
  );
  console.log(`  distinct 200-bodies for identical London request: ${londonBodies.size}`);

  // --- Group B: input variation ---
  console.log("\nGroup B: input variation...");
  const bCases: [string, string, Parameters<typeof probe>[3]?][] = [
    ["multi-word", weatherUrl("location=New%20York"), {}],
    ["unicode-sao-paulo", weatherUrl("location=S%C3%A3o%20Paulo"), {}],
    ["unicode-zurich", weatherUrl("location=Z%C3%BCrich"), {}],
    ["unknown-city", weatherUrl("location=Xyzzyville"), {}],
    ["empty-param", weatherUrl("location="), {}],
    ["missing-param", weatherUrl(""), {}],
    ["lowercase", weatherUrl("location=london"), {}],
    ["long-string", weatherUrl(`location=${"a".repeat(500)}`), {}],
    ["numeric", weatherUrl("location=12345"), {}],
    ["no-key", weatherUrl("location=London"), { noKey: true }],
    ["bad-key", weatherUrl("location=London"), { key: "invalid-key-123" }],
    ["post-method", weatherUrl("location=London"), { method: "POST" }],
  ];
  for (const [name, url, opts] of bCases) {
    const r = await probe("B-weather-variation", name, url, opts);
    console.log(`  ${name}: status=${r.status ?? r.errorName} ${r.latencyMs}ms body=${r.bodyText.slice(0, 120).replaceAll("\n", "\\n")}`);
    await sleep(150);
  }
  const bResearch: [string, string, Parameters<typeof probe>[3]?][] = [
    ["multi-word", researchUrl("topic=climate%20change"), {}],
    ["empty-param", researchUrl("topic="), {}],
    ["missing-param", researchUrl(""), {}],
    ["nonsense-topic", researchUrl("topic=xyzzy%20flurble"), {}],
    ["no-key", researchUrl("topic=solar+energy"), { noKey: true }],
  ];
  for (const [name, url, opts] of bResearch) {
    const r = await probe("B-research-variation", name, url, opts);
    console.log(`  research/${name}: status=${r.status ?? r.errorName} ${r.latencyMs}ms body=${r.bodyText.slice(0, 120).replaceAll("\n", "\\n")}`);
    await sleep(150);
  }
  // Unknown path: derive origin from weather URL
  const origin = new URL(WEATHER_URL).origin;
  const rPath = await probe("B-protocol", "unknown-path", `${origin}/nonexistent`);
  console.log(`  unknown-path: status=${rPath.status ?? rPath.errorName} body=${rPath.bodyText.slice(0, 120)}`);
  summarize("B-weather-variation");
  summarize("B-research-variation");

  // --- Group C: concurrency & rate limits ---
  console.log("\nGroup C: concurrency (10 parallel weather, burst of 8, 3 parallel research)...");
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => probe("C-weather-parallel", `par-${i}`, weatherUrl("location=London"))),
  );
  await sleep(300);
  await Promise.all(
    Array.from({ length: 8 }, (_, i) => probe("C-weather-burst2", `burst-${i}`, weatherUrl("location=Tokyo"))),
  );
  await Promise.all(
    Array.from({ length: 3 }, (_, i) => probe("C-research-parallel", `par-${i}`, researchUrl("topic=wind+power"))),
  );
  summarize("C-weather-parallel");
  summarize("C-weather-burst2");
  summarize("C-research-parallel");

  // Rate-limit specific evidence: dump any 429 or rate-limit headers seen anywhere
  const rateLimitHits = results.filter(
    (r) => r.status === 429 || Object.keys(r.headers).some((h) => h.toLowerCase().includes("ratelimit") || h.toLowerCase() === "retry-after"),
  );
  console.log(`\nRate-limit signals across all ${results.length} requests: ${rateLimitHits.length}`);
  for (const r of rateLimitHits.slice(0, 5)) {
    console.log(`  [${r.group}/${r.name}] status=${r.status} headers=${JSON.stringify(r.headers)} body=${r.bodyText.slice(0, 200)}`);
  }

  console.log(`\nDone. ${results.length} requests logged to ${LOG_FILE}`);
}

main();
