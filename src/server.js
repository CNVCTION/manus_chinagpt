import { createServer as createHttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runActor, splitRunCaps } from "./apify.js";
import { estimateSearch, normalizeAli, normalizeTemu, rankOffers, validateSearchInput } from "./normalize.js";

const VERSION = "0.1.0";
const DEFAULT_SPEND_LIMIT = 1.0;
const maxSpendLimit = Number(process.env.MAX_SEARCH_SPEND_USD ?? DEFAULT_SPEND_LIMIT);
const apifyToken = process.env.APIFY_API_TOKEN ?? "";
const temuActorId = process.env.TEMU_ACTOR_ID ?? "crw/temu-products-scraper";
const aliActorId = process.env.ALIEXPRESS_ACTOR_ID ?? "omkar-cloud/aliexpress-scraper";

function textResult(text, structuredContent, isError = false) {
  return { content: [{ type: "text", text }], structuredContent, ...(isError ? { isError: true } : {}) };
}

async function collectSearches({ queries, shipToCountry, maxResultsPerQuery, cap }) {
  const estimate = estimateSearch({ queries, shipToCountry, maxResultsPerQuery });
  const offers = [];
  const runs = [];
  const warnings = [];
  const caps = splitRunCaps(cap, estimate);
  const tasks = [];

  if (estimate.marketplaces.includes("Temu")) {
    queries.forEach((keyword, index) => {
      tasks.push((async () => {
        const result = await runActor({
          token: apifyToken,
          actorId: temuActorId,
          input: { keyword, region: "US", sort: "price_low_to_high", max_items: maxResultsPerQuery },
          maxTotalChargeUsd: caps.temuCaps[index],
          maxItems: maxResultsPerQuery,
          timeoutSeconds: 240,
        });
        runs.push({ marketplace: "Temu", query: keyword, run_id: result.runId, dataset_id: result.datasetId ?? null });
        offers.push(...result.items.map(normalizeTemu).filter(Boolean));
      })());
    });
  } else {
    warnings.push("Temu was not queried: the configured search Actor supports only the US storefront.");
  }

  const aliResultCap = queries.length * maxResultsPerQuery;
  tasks.push((async () => {
    const result = await runActor({
      token: apifyToken,
      actorId: aliActorId,
      input: {
        searchQueries: queries,
        maxResults: maxResultsPerQuery,
        fetchProductDetails: true,
        country_code: shipToCountry,
        sort_by: "price_low_to_high",
      },
      maxTotalChargeUsd: caps.aliCap,
      maxItems: aliResultCap,
      timeoutSeconds: 240,
    });
    runs.push({ marketplace: "AliExpress", query: queries.join(" | "), run_id: result.runId, dataset_id: result.datasetId ?? null });
    offers.push(...result.items.map((item) => normalizeAli(item, shipToCountry)).filter(Boolean));
  })());

  const outcomes = await Promise.allSettled(tasks);
  const failures = outcomes.filter((result) => result.status === "rejected").map((result) => result.reason?.message ?? String(result.reason));
  if (failures.length && !offers.length) throw new Error(`All marketplace searches failed: ${failures.join("; ")}`);
  if (failures.length) warnings.push(...failures.map((failure) => `A marketplace search failed: ${failure}`));
  if (offers.some((offer) => offer.marketplace === "Temu")) warnings.push("Temu results show listed prices only; shipping, tax, coupons, and selected variant were not verified.");
  warnings.push("Prices are a time-stamped search snapshot, not a guarantee of the checkout price or of the absolute lowest listing.");
  const ranked = rankOffers(offers);
  return {
    query_phrases: queries,
    ship_to_country: shipToCountry,
    currency_note: "Only compare amounts in the same currency. AliExpress is localized by destination; Temu is US/USD in this configuration.",
    result_count: ranked.length,
    offers: ranked,
    runs,
    cost: {
      confirmed_total_cap_usd: cap,
      estimated_actor_result_charges_usd: estimate.estimated_actor_charges_usd,
      note: "The Apify API receives per-run total-charge caps and result-count caps. Actual plan billing and Actor pricing can change; review Apify usage after searches.",
    },
    warnings,
  };
}

function buildMcpServer() {
  const server = new McpServer({ name: "temu-ali-price-scout", version: VERSION });
  server.registerTool("estimate_search_cost", {
    title: "Estimate marketplace search cost",
    description: "Estimate published Apify Actor result charges for a proposed Temu/AliExpress search. This does not start a run or access either marketplace.",
    inputSchema: {
      queries: z.array(z.string().min(2).max(100)).min(1).max(3),
      ship_to_country: z.string().length(2).default("US"),
      max_results_per_query: z.number().int().min(10).max(20).default(10),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  }, async ({ queries, ship_to_country, max_results_per_query }) => {
    try {
      const estimate = estimateSearch({ queries, shipToCountry: ship_to_country, maxResultsPerQuery: max_results_per_query });
      return textResult(`Estimated Actor result charges: about $${estimate.estimated_actor_charges_usd.toFixed(2)} for up to ${estimate.estimated_max_results} results. ${estimate.additional_usage_note}`, estimate);
    } catch (error) {
      return textResult(error.message, { error: error.message }, true);
    }
  });

  server.registerTool("search_prices", {
    title: "Search Temu and AliExpress prices",
    description: "Read-only marketplace search via metered Apify Actors. Before calling this tool, obtain the user's explicit approval of a maximum USD spend for this one search. Provide 1–3 specific, related phrases and the ship-to country. The server refuses searches without an approved cap and passes it to Apify. No purchases, account changes, messages, or writes are performed.",
    inputSchema: {
      queries: z.array(z.string().min(2).max(100)).min(1).max(3),
      ship_to_country: z.string().length(2).default("US"),
      max_results_per_query: z.number().int().min(10).max(20).default(10),
      confirmed_max_spend_usd: z.number().positive().max(maxSpendLimit),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  }, async ({ queries, ship_to_country, max_results_per_query, confirmed_max_spend_usd }) => {
    let validated;
    try {
      validated = validateSearchInput({ queries, ship_to_country, max_results_per_query, confirmed_max_spend_usd }, maxSpendLimit);
    } catch (error) {
      return textResult(error.message, { run_started: false, error: error.message }, true);
    }
    if (!apifyToken) {
      const message = "APIFY_API_TOKEN is not configured. No marketplace run was started. Set the token in the server's private environment, then restart it; never paste it into a ChatGPT message.";
      return textResult(message, { run_started: false, error: "missing_server_credential" }, true);
    }
    try {
      const data = await collectSearches(validated);
      const summary = `Collected ${data.result_count} listings for ${validated.queries.join(" / ")} at a maximum approved spend of $${validated.cap.toFixed(2)}. ${data.warnings.join(" ")}`;
      return textResult(summary, data);
    } catch (error) {
      return textResult(error.message, { run_started: true, error: error.message }, true);
    }
  });
  return server;
}

const transportMode = process.env.MCP_TRANSPORT ?? "http";
if (transportMode === "stdio") {
  const server = buildMcpServer();
  await server.connect(new StdioServerTransport());
} else {
  const host = process.env.MCP_HOST ?? "127.0.0.1";
  const port = Number(process.env.MCP_PORT ?? 8787);
  const isLocalHost = ["127.0.0.1", "::1", "localhost"].includes(host);
  if (!isLocalHost && !process.env.MCP_ACCESS_TOKEN) {
    throw new Error("Refusing to bind to a non-local interface without MCP_ACCESS_TOKEN. Prefer a private Secure MCP Tunnel; never expose an unauthenticated endpoint publicly.");
  }
  const httpServer = createHttpServer(async (req, res) => {
    if (!req.url) return res.writeHead(400).end("Missing URL");
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, name: "temu-ali-price-scout", version: VERSION }));
    }
    if (url.pathname !== "/mcp") return res.writeHead(404).end("Not found");
    if (req.method === "OPTIONS") {
      return res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id",
        "Access-Control-Expose-Headers": "Mcp-Session-Id",
      }).end();
    }
    const accessToken = process.env.MCP_ACCESS_TOKEN;
    if (accessToken && req.headers.authorization !== `Bearer ${accessToken}`) {
      return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "Unauthorized" }));
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    const mcpServer = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void mcpServer.close(); });
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("MCP request failed:", error instanceof Error ? error.message : String(error));
      if (!res.headersSent) res.writeHead(500).end("Internal MCP error");
    }
  });
  httpServer.listen(port, host, () => console.log(`Price Scout MCP listening on http://${host}:${port}/mcp (local/private use only)`));
}

export { buildMcpServer };
