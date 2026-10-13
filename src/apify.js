const APIFY_API_BASE = "https://api.apify.com/v2";

function actorPath(actorId) {
  return String(actorId).replace("/", "~");
}

function withToken(url, token) {
  const parsed = new URL(url);
  parsed.searchParams.set("token", token);
  return parsed;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 1000) }; }
  if (!response.ok) {
    const detail = data?.error?.message ?? data?.message ?? `HTTP ${response.status}`;
    throw new Error(`Apify API error: ${detail}`);
  }
  return data;
}

export async function runActor({ token, actorId, input, maxTotalChargeUsd, maxItems, timeoutSeconds = 240 }) {
  if (!token) throw new Error("APIFY_API_TOKEN is not configured. Add it to the server's local environment; do not put it in a ChatGPT prompt.");
  if (!actorId || !input || !Number.isFinite(maxTotalChargeUsd) || maxTotalChargeUsd <= 0) {
    throw new Error("Actor id, input, and positive per-run spending cap are required.");
  }
  const url = withToken(`${APIFY_API_BASE}/actors/${actorPath(actorId)}/runs`, token);
  url.searchParams.set("timeout", String(timeoutSeconds));
  url.searchParams.set("waitForFinish", "45");
  url.searchParams.set("maxTotalChargeUsd", maxTotalChargeUsd.toFixed(2));
  if (Number.isInteger(maxItems) && maxItems > 0) url.searchParams.set("maxItems", String(maxItems));

  const started = await requestJson(url, { method: "POST", body: JSON.stringify(input), timeoutMs: 55000 });
  const initial = started?.data;
  if (!initial?.id) throw new Error("Apify did not return an Actor run id.");
  let run = initial;
  const deadline = Date.now() + (timeoutSeconds + 15) * 1000;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const statusUrl = withToken(`${APIFY_API_BASE}/actor-runs/${encodeURIComponent(initial.id)}`, token);
    const status = await requestJson(statusUrl, { timeoutMs: 30000 });
    run = status?.data ?? run;
  }
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify Actor ${actorId} ended with status ${run.status ?? "unknown"}${run.statusMessage ? `: ${run.statusMessage}` : ""}. Run id: ${initial.id}. Do not retry automatically; the capped run may still have incurred usage.`);
  }
  if (!run.defaultDatasetId) return { runId: initial.id, items: [] };
  const itemsUrl = withToken(`${APIFY_API_BASE}/datasets/${encodeURIComponent(run.defaultDatasetId)}/items`, token);
  itemsUrl.searchParams.set("clean", "true");
  itemsUrl.searchParams.set("format", "json");
  itemsUrl.searchParams.set("limit", String(Math.max(1, Math.min(100, Number(maxItems) || 20))));
  const items = await requestJson(itemsUrl, { timeoutMs: 45000 });
  return { runId: initial.id, datasetId: run.defaultDatasetId, items: Array.isArray(items) ? items : [] };
}

export function splitRunCaps(totalCap, estimate) {
  if (!estimate.marketplaces.includes("Temu")) return { temuCaps: [], aliCap: Number(totalCap.toFixed(2)) };
  const rowsPerPhrase = estimate.max_results_per_query;
  const temuWeight = estimate.query_count * rowsPerPhrase * estimate.actor_rates.temu_usd_per_result;
  const aliWeight = estimate.query_count * rowsPerPhrase * estimate.actor_rates.aliexpress_usd_per_result;
  const totalWeight = temuWeight + aliWeight;
  const temuPool = totalCap * (temuWeight / totalWeight);
  const temuCaps = Array.from({ length: estimate.query_count }, (_, index) => {
    if (index === estimate.query_count - 1) return Number((temuPool - temuCapsPrefixTotal(temuPool, estimate.query_count, index)).toFixed(2));
    return Number((temuPool / estimate.query_count).toFixed(2));
  });
  const temuRoundedTotal = temuCaps.reduce((a, b) => a + b, 0);
  return { temuCaps, aliCap: Number((totalCap - temuRoundedTotal).toFixed(2)) };
}

function temuCapsPrefixTotal(pool, count, prefixLength) {
  return Array.from({ length: prefixLength }, () => Number((pool / count).toFixed(2))).reduce((a, b) => a + b, 0);
}
