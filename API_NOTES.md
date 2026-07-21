# API Notes — discovered behaviors

Findings from probing the APIs before integration (`scripts/probe.ts` + `scripts/probe-followup.ts`,
raw evidence in `scripts/probe-results.ndjson`, not committed).
Last probe run: 2026-07-22, 96 requests total.

## Baseline (happy path)

| Endpoint | Success status | Latency p50 / p95 / max | Response shape |
|---|---|---|---|
| /weather | 200 | ~165ms / ~300ms / 5113ms (cold start) | `{ location, temperature_c, condition, humidity }` |
| /research | 200 | ~5.3s / ~8.1s / 8138ms | `{ topic, summary, sources[], generated_at }` |

Shape consistency for identical params: **varies** — see F2. Values for the same location are stable within a run (e.g. Paris 19.3°C across 5 calls) and drift over time, as real weather would.

## Findings

### F1. Rate limiting disguised as HTTP 200 — shared across both endpoints
- **Observed:** After 5 successful requests, every request returns **status 200** with body `{"status":"throttled","message":"Rate limit exceeded. Please wait.","retry_after_seconds":N,"data":null}`. No 429, no `Retry-After`/`X-RateLimit-*` headers anywhere (0 hits in 96 requests). `retry_after_seconds` starts at ~28 and counts down in real time; sending more requests while throttled does **not** extend the penalty. Limit confirmed as exactly **5 requests per ~30s fixed window**: 7 paced calls at 1/s → first 5 succeed, #6 and #7 throttled. Pool is **shared across endpoints**: 2 weather + 2 research + 1 weather succeeded, the 6th call (weather) throttled.
- **How discovered:** Group A repetition (weather ×25 tripped it at call #6); threshold and shared-pool confirmed with paced follow-up tests.
- **Error case:** Any call, either endpoint, after 5 calls in the current window → 200 + throttle body. Naive code would happily treat this as a successful weather/research result and feed garbage to the LLM.
- **Handling plan:** Detect `status: "throttled"` in any 200 body before treating it as data. Wait `retry_after_seconds` (capped) and retry once where sensible, showing the user a "rate limited, retrying in Ns" pending state; otherwise return a clear tool-result error so the LLM can explain. Cancellation must work during the wait.

### F2. Weather success responses have two different shapes for the same request
- **Observed:** The same `location=London` request non-deterministically returns either the flat shape `{"location","temperature_c","condition","humidity"}` or `{"location","conditions":[{...},{...}],"note":"Multiple conditions reported"}` — an array of 2 condition objects (~40% of successful calls in our runs: 3/5, then 1/5). Inner array objects use the same fields; secondary condition values differ (e.g. "light rain").
- **How discovered:** Group A shape-signature dedup flagged 2 distinct success shapes for identical input.
- **Error case:** Code assuming `temperature_c` at the top level gets `undefined` on multi-condition responses.
- **Handling plan:** Normalize both shapes into one internal type before handing data to the LLM (treat flat as a 1-element conditions list; pass all conditions through so the LLM can mention both).

### F3. Unicode mangling in weather locations
- **Observed:** `location=São Paulo` (properly URL-encoded UTF-8) returns 200 with `"location":"San Paulo"` — the API echoes back a corrupted city name ("ã" → "an"?). Lookup itself succeeds.
- **How discovered:** Group B input variation, unicode retest after the throttle-poisoned first attempt.
- **Error case:** Display/history shows a wrong city name; the LLM may repeat "San Paulo" to the user.
- **Handling plan:** Not fixable client-side. Keep the user's original input as the source of truth in conversation; pass API data through as-is. Documented so it's explainable, not surprising.

### F4. Inconsistent error formats across failure types
- **Observed:** Four different error body shapes:
  - 404 unknown location: `{"error":"Location \"Xyzzyville\" not found"}`
  - 401 bad/missing key: `{"error":"Invalid or missing API key"}`
  - 422 missing query param: FastAPI-style `{"detail":[{"type":"missing","loc":["query","location"],...}]}`
  - 405 wrong method / 404 unknown path: `{"detail":"Method Not Allowed"}` / `{"detail":"Not Found"}`
- **How discovered:** Group B input variation (auth, protocol, param cases).
- **Error case:** A single error-parsing assumption (`body.error`) misses `detail`-style errors and vice versa.
- **Handling plan:** One error extractor: try `body.error`, then `body.detail` (string or validation array), fall back to raw text + status code. Always produce a human-readable tool error, never throw raw JSON at the user.
- **Note:** Auth is checked before rate limiting (401s returned even while throttled).

### F5. Latency edges: cold start and research exceeding its documented ceiling
- **Observed:** First request of a session took 5113ms on **weather** (documented ~200ms) — consistent with serverless cold start; warm calls ~160-300ms. One research call measured 8138ms, slightly above the documented 3-8s.
- **How discovered:** Group A latency stats (max vs p50 gap).
- **Error case:** A timeout tuned to documented latencies (e.g. 2s weather / 8s research) would spuriously kill valid requests.
- **Handling plan:** Generous client timeouts (~15s) with `AbortSignal`, pending indicator for anything slow, treat timeout as a normal, well-messaged failure.

### F6. Empty vs missing param behave differently
- **Observed:** `?location=` (empty) → 404 `{"error":"Location \"\" not found"}`, but omitting the param entirely → 422 validation error. Same pattern on research.
- **How discovered:** Group B input variation.
- **Error case:** Two different failure paths for what is conceptually the same user mistake.
- **Handling plan:** Validate non-empty arguments in the tool layer before calling out; both API variants still mapped to friendly errors via F4's extractor.

## Error responses reference

| Trigger | Status | Body format | Notes |
|---|---|---|---|
| Missing API key | 401 | `{"error":"Invalid or missing API key"}` | checked even while throttled |
| Invalid API key | 401 | `{"error":"Invalid or missing API key"}` | same body as missing |
| Missing param | 422 | FastAPI `{"detail":[...]}` validation array | |
| Empty param (`location=`) | 404 | `{"error":"Location \"\" not found"}` | not a 422 |
| Unknown location | 404 | `{"error":"Location \"X\" not found"}` | |
| Wrong method (POST) | 405 | `{"detail":"Method Not Allowed"}` | |
| Unknown path | 404 | `{"detail":"Not Found"}` | `detail`, not `error` |
| Rate limit | **200** | `{"status":"throttled","message":...,"retry_after_seconds":N,"data":null}` | no 429, no headers; shared 5-per-~30s window |

## Open questions
- Exact window semantics (fixed 30s from first request vs rolling) — countdown behavior suggests fixed; not worth more request budget to pin down precisely.
- Whether research responses are ever non-templated (all summaries followed the same template text) — cosmetic, no handling impact.
- Whether other unicode inputs mangle differently than "ã" → "an" (only São Paulo confirmed; Zürich attempt was throttle-poisoned).
