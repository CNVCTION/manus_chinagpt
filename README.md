# Temu + AliExpress Price Scout

A **read-only MCP plugin kit** for ChatGPT Pro. It searches current public product listings through two Apify marketplace Actors, normalizes results, and reports item-plus-shipping prices only when a destination-matched shipping quote is actually present.

This project is **not yet connected to your ChatGPT or Apify account**. The source is prepared, but live searches require your own Apify token and a secure endpoint/tunnel. No marketplace searches or paid Actor runs were performed while building this package.

## What it does

- `estimate_search_cost` estimates published per-result Actor charges without running a scraper.
- `search_prices` searches up to three related phrases on AliExpress and, for US searches, Temu.
- Every live search requires `confirmed_max_spend_usd`; the server validates it against a configured ceiling and sends Apify per-run total-charge and result caps.
- AliExpress is searched for the requested two-letter destination country, with product details, variants, shipping options, and coupons enabled.
- Temu is currently configured for the **US storefront only**. Its chosen keyword-search Actor supplies listed prices but does not return a verified shipping quote, tax, selected variant, or coupon-adjusted checkout total.
- Product titles and marketplace pages are treated as untrusted data. The server never buys anything or changes marketplace accounts.

## Coverage, reliability, and costs

The configured Actors are `omkar-cloud/aliexpress-scraper` and `crw/temu-products-scraper`. Their Apify Store pages currently show estimated result charges of about **$0.005 per AliExpress result** and **$0.01 per Temu result**. Prices may change. Apify platform usage, retries, proxies, and account billing can add costs. The server applies `maxTotalChargeUsd` and `maxItems` per run; a run can return fewer items if it reaches a cap.

The selected AliExpress Actor exposes destination-specific SKU/shipping data, but it was very new at the time checked (four total users and no monthly active users). It has not been independently runtime-tested. A more-used alternative exists, but its public schema is listing-only and lacks the destination-specific shipping/detail fields needed by this implementation. Treat the AliExpress data connector as an early-stage provider choice that should be tested with a small approved budget before relying on it.

The default maximum approved search spend is `$1.00` for the whole search request. This is an upper ceiling, **not consent to spend**: the user must explicitly approve a concrete maximum for each search in ChatGPT. If the destination is not US, this build skips Temu rather than pretending to compare local Temu prices.

“Best” means the lowest **observed comparable offer** in the returned sample. It does not guarantee every listing or checkout-specific deal. Match the same product model, quantity, size, color, plug type, and other important specifications. The reported `price_plus_shipping` excludes taxes, coupons, and any checkout-only discounts. Final checkout prices can differ.

## Requirements

- Node.js 22 or newer.
- An Apify account and a private Apify API token. A free Apify plan is available; check current terms and usage before running Actors.
- ChatGPT Pro on the web with Developer Mode enabled and access to custom MCP apps/connectors.
- A private MCP tunnel or another secure HTTPS deployment. **Do not expose an unauthenticated server publicly**: anyone who can call it could consume your Apify allowance. ChatGPT Pro custom MCP access is read/fetch only, so this server exposes no marketplace write, purchase, or account-management tools.

## Local setup

```bash
cp .env.example .env
# Edit .env locally and set APIFY_API_TOKEN. Never paste the token into ChatGPT.
npm install
npm test
npm start
```

The HTTP server binds to `127.0.0.1:8787` by default. Its MCP endpoint is `/mcp`; health check is `/health`. Keep it local and use OpenAI's Secure MCP Tunnel (or a private trusted tunnel) to make it available to ChatGPT. ChatGPT does not connect directly to localhost. If you deploy to a public HTTPS host, place it behind an OAuth 2.1-compatible authentication layer before connecting; the development server is not intended for public exposure.

In ChatGPT web, enable Developer Mode under **Settings → Apps / Connected apps** (wording can vary during rollout), then create an MCP app using the secure endpoint and select the available read/fetch tools. Pro users currently have read/fetch MCP access in Developer Mode; full MCP write/modify support is limited to Business/Enterprise/Edu.

The `mcp.json` file is a portable manifest template. Replace its placeholder URL with your secure endpoint before using it in a plugin marketplace or another compatible host.

## Safe search flow

1. Ask the user for must-have product specifications and destination country when missing.
2. Run `estimate_search_cost` and show the per-result estimate plus the warning that Apify/platform usage may add costs.
3. Obtain explicit user approval of a maximum USD spend for that one search.
4. Only then call `search_prices` with the same cap. The server rejects missing, too-low, or over-limit caps before Actor execution.
5. Report result timestamps, links, and whether the amount includes shipping. Do not state “absolute cheapest” where data is incomplete.

`MAX_SEARCH_SPEND_USD` in `.env` is an upper ceiling, not consent to spend. Lower it if desired. The search tool requires the user-approved amount on every search.

## Development and tests

```bash
npm run check
npm test
```

Tests use local fixtures and do not contact Apify or scrape marketplace sites. Live execution is intentionally not tested without the user's token and explicit spending authorization.

## References

- OpenAI, [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) — Pro access, read/fetch limits, and secure tunnels.
- OpenAI, [MCP authentication guide](https://developers.openai.com/plugins/build/auth) — OAuth 2.1 guidance for authenticated MCP servers.
- Apify, [MCP server](https://docs.apify.com/platform/integrations/mcp) — MCP endpoint and tool capabilities.
- Apify, [Run Actor API](https://docs.apify.com/api/v2/actors-runs-post) — run status, `maxTotalChargeUsd`, and `maxItems` controls.
- Apify, [Pricing](https://apify.com/pricing) — free and paid usage terms.
- Apify Actor, [AliExpress Scraper](https://apify.com/omkar-cloud/aliexpress-scraper) — inputs, destination country, variant, and shipping output.
- Apify Actor, [Temu Products Scraper](https://apify.com/crw/temu-products-scraper) — US keyword-search inputs and output fields.
- Temu, [official Research API overview](https://partner-eu.temu.com/documentation?menu_code=98501210a0cc465695e6d94e364bb83c) — official API access is based on approved research projects.
