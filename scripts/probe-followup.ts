// Follow-up probes paced around the discovered rate limit (~5 requests / 30s window).
// Run: npx tsx --env-file=.env scripts/probe-followup.ts

import { appendFileSync } from "node:fs";

const WEATHER_URL = process.env.ELYOS_API_URL_WEATHER!;
const RESEARCH_URL = process.env.ELYOS_API_URL_RESEARCH!;
const API_KEY = process.env.ELYOS_API_KEY!;
const LOG_FILE = new URL("./probe-results.ndjson", import.meta.url).pathname;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(name: string, url: string): Promise<{ throttled: boolean }> {
  const start = performance.now();
  try {
    const res = await fetch(url, { headers: { "X-API-Key": API_KEY }, signal: AbortSignal.timeout(20_000) });
    const bodyText = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(bodyText); } catch {}
    const latencyMs = Math.round(performance.now() - start);
    const throttled = typeof json === "object" && json !== null && (json as any).status === "throttled";
    console.log(`  ${name}: status=${res.status} ${latencyMs}ms ${throttled ? `THROTTLED ra=${(json as any).retry_after_seconds}` : `body=${bodyText.slice(0, 300).replaceAll("\n", "\\n")}`}`);
    appendFileSync(LOG_FILE, JSON.stringify({ group: "followup", name, url, status: res.status, latencyMs, bodyText, headers: Object.fromEntries(res.headers.entries()), ts: new Date().toISOString() }) + "\n");
    return { throttled };
  } catch (err) {
    console.log(`  ${name}: ERROR ${err instanceof Error ? err.name : err} after ${Math.round(performance.now() - start)}ms`);
    appendFileSync(LOG_FILE, JSON.stringify({ group: "followup", name, url, status: null, error: String(err), ts: new Date().toISOString() }) + "\n");
    return { throttled: false };
  }
}

async function cooldown(label: string) {
  console.log(`\n[cooldown 35s — ${label}]`);
  await sleep(35_000);
}

async function main() {
  console.log(`Follow-up probe ${new Date().toISOString()}`);

  await cooldown("let previous window expire");
  console.log("Test 1: real research responses (expect 3-8s latency)");
  await call("research-real-1", `${RESEARCH_URL}?topic=solar+energy`);
  await call("research-real-2", `${RESEARCH_URL}?topic=solar+energy`);

  await cooldown("window reset before input-variation retests");
  console.log("Test 2: weather input variation (5 calls, exactly at limit)");
  await call("unknown-city", `${WEATHER_URL}?location=Xyzzyville`);
  await call("empty-param", `${WEATHER_URL}?location=`);
  await call("unicode", `${WEATHER_URL}?location=S%C3%A3o%20Paulo`);
  await call("multi-word", `${WEATHER_URL}?location=New%20York`);
  await call("lowercase", `${WEATHER_URL}?location=london`);

  await cooldown("window reset before limit-count test");
  console.log("Test 3: throttle threshold (7 paced weather calls, 1/s — expect throttle at #6)");
  for (let i = 1; i <= 7; i++) {
    await call(`count-${i}`, `${WEATHER_URL}?location=Paris`);
    await sleep(1000);
  }

  await cooldown("window reset before shared-pool test");
  console.log("Test 4: shared pool? 2 weather + 2 research + 2 weather — where does throttle start?");
  await call("mix-w1", `${WEATHER_URL}?location=Berlin`);
  await call("mix-w2", `${WEATHER_URL}?location=Berlin`);
  await call("mix-r1", `${RESEARCH_URL}?topic=geothermal`);
  await call("mix-r2", `${RESEARCH_URL}?topic=geothermal`);
  await call("mix-w3", `${WEATHER_URL}?location=Berlin`);
  await call("mix-w4", `${WEATHER_URL}?location=Berlin`);

  console.log("\nDone.");
}

main();
