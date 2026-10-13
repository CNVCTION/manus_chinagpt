# Source notes

Research checked on 2026-10-13. Marketplace pricing and third-party Actor documentation can change; re-check before deployment and before relying on estimates.

- OpenAI custom MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt — Pro users can connect custom MCP apps in Developer Mode with read/fetch permissions; full MCP write/modify is Business/Enterprise/Edu. ChatGPT does not connect directly to localhost; a Secure MCP Tunnel can expose a private service without making it public.
- OpenAI MCP authorization: https://developers.openai.com/plugins/build/auth — authenticated servers should implement OAuth 2.1.
- Apify MCP: https://docs.apify.com/platform/integrations/mcp — hosted MCP endpoint and available Actor tools.
- Apify Run Actor API: https://docs.apify.com/api/v2/actors-runs-post — `/v2/actors/:actorId/runs` supports `maxTotalChargeUsd` to cap total run cost and `maxItems` to cap billable pay-per-result items.
- Apify pricing: https://apify.com/pricing — free and paid usage allowances vary by account plan.
- Selected AliExpress Actor: https://apify.com/omkar-cloud/aliexpress-scraper — `searchQueries`, `maxResults`, `country_code`, `fetchProductDetails`, `sort_by`; result rows can contain SKU variants and country-matched shipping options. At research time it was very new (four total users, zero monthly active users, recently modified) and displayed about $5 per 1,000 results. It was selected for localized detail/shipping data, not because its reliability has been independently proven.
- Alternative AliExpress listing Actor: https://apify.com/pintostudio/aliexpress-product-search — more usage history at check time (383 total users, 33 monthly active users; about $3.30 per 1,000) and keyword search results with sale price and selling-point tags, but the documented interface is page-based and does not provide full SKU/shipping details or a clear destination-country input. It was not selected for the shipping-aware schema.
- Temu Actor: https://apify.com/crw/temu-products-scraper — community Actor advertises live keyword product search for US only, results include listing prices, ratings and URLs; published result charge $10 / 1,000; no verified shipping quote in documented output.
- Temu official Research API overview: https://partner-eu.temu.com/documentation?menu_code=98501210a0cc465695e6d94e364bb83c — approved project required.
- Temu official approved-mall goods query: https://partner-eu.temu.com/documentation?menu_code=98501210a0cc465695e6d94e364bb83c&sub_menu_code=4528d74753ee409a97bf025d56a687ac — expects approved mall name, country, and page number, not unrestricted consumer keyword search.
