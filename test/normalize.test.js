import test from "node:test";
import assert from "node:assert/strict";
import { estimateSearch, normalizeAli, normalizeTemu, parseMoney, rankOffers, validateSearchInput } from "../src/normalize.js";
import { splitRunCaps } from "../src/apify.js";

test("parses common price formats", () => {
  assert.equal(parseMoney("$1,234.56"), 1234.56);
  assert.equal(parseMoney("1.234,56 €"), 1234.56);
  assert.equal(parseMoney("1,85 €"), 1.85);
});

test("normalizes Temu cents using the formatted price when available", () => {
  const offer = normalizeTemu({ goods_id: 9, title: "LED lamp", price: 185, price_str: "$1.85", currency: "USD", link_url: "https://www.temu.com/goods.html?id=9" });
  assert.equal(offer.listed_price, 1.85);
  assert.equal(offer.price_plus_shipping, null);
  assert.equal(offer.shipping_status, "unknown");
});

test("normalizes AliExpress nested SKU pricing and matching destination shipping", () => {
  const offer = normalizeAli({
    id: "a1",
    title: "Travel charger",
    link: "https://www.aliexpress.us/item/a1.html",
    pricing: { sale_price: 9, original_price: 12, currency: "USD", tax_rate: 0 },
    skus: [
      { label: "45W", is_available: true, pricing: { sale_price: 10, original_price: 14, currency: "USD" } },
      { label: "65W", is_available: true, stock: 12, pricing: { sale_price: 8, original_price: 16, currency: "USD" } },
    ],
    shipping: { ship_to: "US", options: [
      { name: "US tracked", price: null, currency: "USD", is_free: true, min_delivery_days: 5, max_delivery_days: 8 },
      { name: "CA tracked", price: 1, currency: "CAD", is_free: false, ship_to: "CA" },
    ] },
    reviews_count: 56,
    orders_count: 474,
  }, "US");
  assert.equal(offer.listed_price, 8);
  assert.equal(offer.shipping_fee, 0);
  assert.equal(offer.price_plus_shipping, 8);
  assert.equal(offer.shipping_status, "free");
  assert.equal(offer.selected_variant.label, "65W");
  assert.equal(offer.review_count, 56);
});

test("does not use mismatched shipping quotes", () => {
  const offer = normalizeAli({
    id: "a2", title: "Lamp", pricing: { sale_price: 5, currency: "USD" },
    shipping: { ship_to: "CA", options: [{ price: 1, currency: "CAD", is_free: false }] },
  }, "US");
  assert.equal(offer.price_plus_shipping, null);
  assert.equal(offer.shipping_status, "unknown");
});

test("ranks verified price-plus-shipping ahead of unknown-shipping listings", () => {
  const verified = normalizeAli({ id: "a3", title: "Item A", pricing: { sale_price: 9, currency: "USD" }, shipping: { ship_to: "US", options: [{ price: 1, currency: "USD", is_free: false }] } }, "US");
  const unknown = normalizeTemu({ goods_id: "t1", title: "Item B", price: 800, price_str: "$8.00", currency: "USD" });
  const ranked = rankOffers([unknown, verified]);
  assert.equal(ranked[0].marketplace, "AliExpress");
  assert.equal(ranked[1].marketplace, "Temu");
});

test("estimates a US search and skips Temu for unsupported regions", () => {
  const us = estimateSearch({ queries: ["wireless earbuds"], shipToCountry: "US", maxResultsPerQuery: 10 });
  assert.deepEqual(us.marketplaces, ["Temu", "AliExpress"]);
  assert.equal(us.estimated_actor_charges_usd, 0.15);
  const ca = estimateSearch({ queries: ["wireless earbuds"], shipToCountry: "CA", maxResultsPerQuery: 10 });
  assert.deepEqual(ca.marketplaces, ["AliExpress"]);
  assert.ok(ca.region_note.includes("US storefront only"));
});

test("rejects a search cap below the estimated result charge before any run", () => {
  assert.throws(() => validateSearchInput({
    queries: ["wireless earbuds"], ship_to_country: "US", max_results_per_query: 10, confirmed_max_spend_usd: 0.10,
  }, 1), /below the estimated actor-result charge/);
});

test("allocates per-run caps that sum to the approved total", () => {
  const estimate = estimateSearch({ queries: ["phone case", "case cover"], shipToCountry: "US", maxResultsPerQuery: 10 });
  const caps = splitRunCaps(0.31, estimate);
  assert.equal(caps.temuCaps.length, 2);
  assert.ok(Math.abs(caps.temuCaps.reduce((a, b) => a + b, 0) + caps.aliCap - 0.31) < 0.001);
  assert.ok(caps.temuCaps.every((value) => value > 0));
  assert.ok(caps.aliCap > 0);
});

test("rejects more than three or malformed search phrases", () => {
  assert.throws(() => estimateSearch({ queries: ["aa", "bb", "cc", "dd"] }), /between 1 and 3/);
  assert.throws(() => estimateSearch({ queries: ["x"] }), /2–100 characters/);
});
