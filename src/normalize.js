const TEMU_USD_PER_RESULT = 0.01;
const ALI_USD_PER_RESULT = 0.005;

export function parseMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  const numeric = text.replace(/[^0-9,.-]/g, "");
  if (!numeric || !/[0-9]/.test(numeric)) return null;
  const comma = numeric.lastIndexOf(",");
  const dot = numeric.lastIndexOf(".");
  let normalized = numeric;
  if (comma >= 0 && dot >= 0) {
    const decimalMark = comma > dot ? "," : ".";
    const groupingMark = decimalMark === "," ? "." : ",";
    normalized = numeric.split(groupingMark).join("").replace(decimalMark, ".");
  } else if (comma >= 0) {
    const decimals = numeric.length - comma - 1;
    normalized = decimals > 0 && decimals <= 2 ? numeric.replace(",", ".") : numeric.replace(/,/g, "");
  } else if ((numeric.match(/\./g) ?? []).length > 1) {
    const last = numeric.lastIndexOf(".");
    const decimals = numeric.length - last - 1;
    normalized = decimals > 0 && decimals <= 2
      ? numeric.slice(0, last).replace(/\./g, "") + numeric.slice(last)
      : numeric.replace(/\./g, "");
  }
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function skuPrice(sku) {
  return parseMoney(firstValue(sku?.pricing?.sale_price, sku?.price, sku?.salePrice));
}

function lowestVariant(skus = []) {
  const variants = Array.isArray(skus) ? skus : [];
  return variants
    .map((sku) => ({ sku, price: skuPrice(sku) }))
    .filter((item) => item.price !== null && item.sku?.is_available !== false && item.sku?.available !== false)
    .sort((a, b) => a.price - b.price)[0] ?? null;
}

function matchingShipping(shipping, country, currency) {
  if (shipping && !Array.isArray(shipping) && shipping.ship_to && String(shipping.ship_to).toUpperCase() !== country) return null;
  const rows = Array.isArray(shipping) ? shipping : Array.isArray(shipping?.options) ? shipping.options : [];
  const valid = rows.filter((option) => {
    const shipTo = String(option?.shipTo ?? option?.ship_to ?? shipping?.ship_to ?? "").toUpperCase();
    const countryMatches = !shipTo || shipTo === country;
    const feeCurrency = String(option?.currency ?? currency ?? "").toUpperCase();
    return countryMatches && feeCurrency === currency;
  }).map((option) => ({
    option,
    fee: option?.is_free === true || option?.free === true ? 0 : parseMoney(firstValue(option?.price, option?.fee)),
  })).filter((item) => item.fee !== null);
  return valid.sort((a, b) => a.fee - b.fee)[0] ?? null;
}

export function normalizeAli(row, country = "US") {
  if (!row || typeof row !== "object" || row.type === "review") return null;
  const variant = lowestVariant(row.skus);
  const selectedPricing = variant?.sku?.pricing;
  const price = parseMoney(firstValue(selectedPricing?.sale_price, variant?.price, row?.pricing?.sale_price, row?.priceMin, row?.price));
  const currency = String(firstValue(selectedPricing?.currency, row?.pricing?.currency, row?.currency, "") ?? "").toUpperCase();
  if (price === null || !currency) return null;
  const shipping = matchingShipping(row.shipping, country.toUpperCase(), currency);
  const shippingFee = shipping?.fee ?? null;
  return {
    marketplace: "AliExpress",
    product_id: String(firstValue(row.productId, row.id, "")),
    title: String(firstValue(row.title, row.productName, "Untitled product")),
    url: String(firstValue(row.url, row.link, row.productDetailUrl, "")),
    image_url: firstValue(row.image, row.imageUrl, row.images?.[0], null),
    currency,
    listed_price: price,
    original_price: parseMoney(firstValue(selectedPricing?.original_price, row?.pricing?.original_price, row?.originalPrice)),
    rating: parseMoney(firstValue(row.rating, row.evaluation?.starRating)),
    review_count: parseMoney(firstValue(row.reviews_count, row.reviewCount, row.reviewsCount, row.evaluation?.reviewCount)),
    sold_count: parseMoney(firstValue(row.orders_count, row.soldCount, row.trade?.soldCount)),
    shipping_fee: shippingFee,
    shipping_status: shipping ? (shippingFee === 0 ? "free" : "quoted") : "unknown",
    shipping_method: shipping?.option?.name ?? shipping?.option?.method ?? null,
    delivery_days_min: parseMoney(firstValue(shipping?.option?.min_delivery_days, shipping?.option?.deliveryDaysMin)),
    delivery_days_max: parseMoney(firstValue(shipping?.option?.max_delivery_days, shipping?.option?.deliveryDaysMax)),
    ship_to: String(firstValue(row.shipping?.ship_to, shipping?.option?.ship_to, shipping?.option?.shipTo, "") || country.toUpperCase()),
    price_plus_shipping: shippingFee === null ? null : Number((price + shippingFee).toFixed(2)),
    tax_rate: parseMoney(row?.pricing?.tax_rate),
    selected_variant: variant ? { label: variant.sku.label ?? null, attributes: variant.sku.attributes ?? null } : null,
    variants: Array.isArray(row.skus) ? row.skus.slice(0, 20) : [],
    specifications: Array.isArray(row.specifications) ? row.specifications.slice(0, 30) : [],
    coupons: Array.isArray(row.coupons) ? row.coupons : [],
    seller: firstValue(row.store_name, row.store?.name, null),
    stock: parseMoney(firstValue(variant?.sku?.stock, row.stock)),
    is_ad: row.isAd ?? false,
    source_updated_at: row.scrapedAt ?? null,
    price_basis: "localized variant price; matching shipping added when quoted; taxes, coupons, and checkout conditions are not included",
  };
}

export function normalizeTemu(row) {
  if (!row || typeof row !== "object") return null;
  // The published sample uses integer cents in `price` and a formatted value in `price_str`.
  const formatted = parseMoney(firstValue(row.price_str, row.priceText));
  const raw = parseMoney(firstValue(row.price, row.currentPrice));
  const price = formatted !== null ? formatted : raw !== null ? raw / 100 : null;
  const currency = String(firstValue(row.currency, "USD") ?? "USD").toUpperCase();
  if (price === null) return null;
  const originalFormatted = parseMoney(firstValue(row.market_price_str, row.originalPriceText));
  const originalRaw = parseMoney(firstValue(row.market_price, row.originalPrice));
  return {
    marketplace: "Temu",
    product_id: String(firstValue(row.goods_id, row.goodsId, row.id, "")),
    title: String(firstValue(row.title, row.productName, "Untitled product")),
    url: String(firstValue(row.link_url, row.url, row.productUrl, "")),
    image_url: firstValue(row.image_url, row.thumb_url, row.imageUrl, null),
    currency,
    listed_price: price,
    original_price: originalFormatted ?? (originalRaw !== null ? originalRaw / 100 : null),
    rating: parseMoney(firstValue(row.rating, row.goodsScore)),
    review_count: parseMoney(firstValue(row.review_count, row.reviewCount, row.totalReviews)),
    sold_count: parseMoney(firstValue(row.sales_num, row.salesCount, row.salesVolume)),
    shipping_fee: null,
    shipping_status: "unknown",
    shipping_method: null,
    delivery_days_min: null,
    delivery_days_max: null,
    ship_to: "US",
    price_plus_shipping: null,
    tax_rate: null,
    selected_variant: null,
    variants: [],
    specifications: [],
    coupons: [],
    seller: firstValue(row.mall_id, row.mallId, row.storeName, null),
    is_ad: row.is_ad ?? false,
    source_updated_at: row.scrapedAt ?? null,
    price_basis: "Temu listed price only; shipping, tax, selected variant, and coupons not verified by this search Actor",
  };
}

export function estimateSearch({ queries, shipToCountry = "US", maxResultsPerQuery = 10 }) {
  const terms = normalizeQueries(queries);
  const count = Math.max(10, Math.min(20, Number(maxResultsPerQuery) || 10));
  const country = String(shipToCountry).toUpperCase();
  const temuEnabled = country === "US";
  const temuRows = temuEnabled ? terms.length * count : 0;
  const aliRows = terms.length * count;
  const temuActorEstimate = temuRows * TEMU_USD_PER_RESULT;
  const aliActorEstimate = aliRows * ALI_USD_PER_RESULT;
  const estimatedActorCharges = Number((temuActorEstimate + aliActorEstimate).toFixed(4));
  return {
    query_count: terms.length,
    max_results_per_query: count,
    ship_to_country: country,
    marketplaces: temuEnabled ? ["Temu", "AliExpress"] : ["AliExpress"],
    estimated_max_results: temuRows + aliRows,
    estimated_actor_charges_usd: estimatedActorCharges,
    actor_rates: { temu_usd_per_result: TEMU_USD_PER_RESULT, aliexpress_usd_per_result: ALI_USD_PER_RESULT },
    additional_usage_note: "Estimate uses current published per-result Actor rates. Apify account/platform usage, retries, and price changes may add cost; the server also passes an Apify run cost cap.",
    region_note: temuEnabled ? null : "The configured Temu search Actor currently supports the US storefront only; no Temu run will be started for this country.",
  };
}

export function normalizeQueries(queries) {
  if (!Array.isArray(queries) || queries.length < 1 || queries.length > 3) throw new Error("Provide between 1 and 3 distinct search query phrases.");
  const cleaned = [...new Set(queries.map((value) => String(value).trim()).filter(Boolean))];
  if (cleaned.length < 1 || cleaned.length > 3 || cleaned.some((value) => value.length < 2 || value.length > 100)) {
    throw new Error("Each search phrase must be 2–100 characters; provide 1–3 distinct phrases.");
  }
  return cleaned;
}

export function validateSearchInput(args, maxSpendLimit) {
  const queries = normalizeQueries(args.queries);
  const shipToCountry = String(args.ship_to_country ?? "US").toUpperCase();
  if (!/^[A-Z]{2}$/.test(shipToCountry)) throw new Error("ship_to_country must be an ISO two-letter country code.");
  const maxResultsPerQuery = Number(args.max_results_per_query ?? 10);
  if (!Number.isInteger(maxResultsPerQuery) || maxResultsPerQuery < 10 || maxResultsPerQuery > 20) throw new Error("max_results_per_query must be an integer from 10 to 20.");
  const cap = Number(args.confirmed_max_spend_usd);
  if (!Number.isFinite(cap) || cap <= 0 || cap > maxSpendLimit) throw new Error(`confirmed_max_spend_usd must be a positive number no greater than the server limit of $${maxSpendLimit.toFixed(2)}.`);
  const estimate = estimateSearch({ queries, shipToCountry, maxResultsPerQuery });
  if (cap < estimate.estimated_actor_charges_usd) {
    throw new Error(`The confirmed cap ($${cap.toFixed(2)}) is below the estimated actor-result charge ($${estimate.estimated_actor_charges_usd.toFixed(2)}). No searches were started. Lower the result count or confirm a higher cap, up to $${maxSpendLimit.toFixed(2)}.`);
  }
  return { queries, shipToCountry, maxResultsPerQuery, cap, estimate };
}

export function rankOffers(rows) {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    if (!row) continue;
    const titleKey = row.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const key = row.product_id ? `${row.marketplace}:${row.product_id}` : `${row.marketplace}:${titleKey}:${row.listed_price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique.sort((a, b) => {
    if (a.currency !== b.currency) return a.marketplace.localeCompare(b.marketplace);
    const aTotal = a.price_plus_shipping;
    const bTotal = b.price_plus_shipping;
    if (aTotal !== null && bTotal !== null) return aTotal - bTotal;
    if (aTotal !== null) return -1;
    if (bTotal !== null) return 1;
    return a.listed_price - b.listed_price;
  });
}
