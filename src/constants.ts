export const LLM_MODEL = "claude-opus-4-8";
export const LLM_MAX_TOKENS = 8192;

export const API_MAX_ATTEMPTS = 3;
export const API_TIMEOUT_MS = 15_000; // tolerates weather cold starts (~5s) and research >8s (F5)
export const API_THROTTLE_WAIT_CAP_S = 30;
