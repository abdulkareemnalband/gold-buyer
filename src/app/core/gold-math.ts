import { GoldRate, GRAMS_PER_CARAT, Karat, Metal, Stone, StoneRate, StoneUnit } from './models';

/**
 * Every price calculation in the app lives here. These functions are pure. They take
 * numbers and return numbers, so the unit tests need no browser and no framework.
 */

/** The rate per gram for one karat, derived from the 24kt rate. Any karat works. */
export function ratePerGram(pricePerGram24: number, karat: number): number {
  return (pricePerGram24 * finite(karat)) / 24;
}

/** The 24kt rate that produces the given rate at the given karat. */
export function price24From(rate: number, karat: Karat): number {
  return (rate * 24) / karat;
}

/** The rates of one shop and the tax. Every price in the app needs these. */
export interface Pricing {
  goldRates: readonly GoldRate[];
  silverPricePerGram: number;
  platinumPricePerGram: number;
  gstPercent: number;
  stoneRates: readonly StoneRate[];
}

export interface ArticleInput {
  metal: Metal;
  /** Gold only. The other metals ignore it. */
  karat: number;
  weightGrams: number;
  makingChargePercent: number;
  /** Gold only. An empty string means no booking. */
  bookingDate: string;
  /** Gold only. An empty string means the booking date. */
  purchaseDate: string;
  stones: readonly Stone[];
}

/** The 24kt rate of one dated gold rate. */
export function rate24(rate: GoldRate): number {
  return rate.karat > 0 ? (finite(rate.rate) * 24) / rate.karat : 0;
}

/** The gold rate with the latest date. Of two rates on one day, the later entry wins. */
export function latestGoldRate(rates: readonly GoldRate[]): GoldRate | undefined {
  return rates.reduce<GoldRate | undefined>(
    (best, rate) => (!best || rate.date >= best.date ? rate : best),
    undefined,
  );
}

/**
 * The gold rate for one day.
 *
 * An empty date gives the latest rate. Otherwise the newest rate on or before the day
 * applies. A day before every rate gets the oldest rate. Dates are `YYYY-MM-DD`, so a
 * string compare puts them in order.
 */
export function goldRateOn(rates: readonly GoldRate[], date: string): GoldRate | undefined {
  if (!date) {
    return latestGoldRate(rates);
  }

  const before = latestGoldRate(rates.filter((rate) => rate.date <= date));
  if (before) {
    return before;
  }

  return rates.reduce<GoldRate | undefined>(
    (oldest, rate) => (!oldest || rate.date < oldest.date ? rate : oldest),
    undefined,
  );
}

/** A rate per gram for one piece, and the day of the gold rate it came from. */
export interface MetalRate {
  perGram: number;
  /** The day of the gold rate. Empty for silver and platinum, which have one rate. */
  date: string;
}

function metalRate(pricing: Pricing, metal: Metal, karat: number, date: string): MetalRate {
  switch (metal) {
    case 'silver':
      return { perGram: finite(pricing.silverPricePerGram), date: '' };
    case 'platinum':
      return { perGram: finite(pricing.platinumPricePerGram), date: '' };
    default: {
      const rate = goldRateOn(pricing.goldRates, date);
      return { perGram: rate ? ratePerGram(rate24(rate), karat) : 0, date: rate?.date ?? '' };
    }
  }
}

/**
 * The rate that sets the metal value. A gold piece uses the rate of its booking date.
 * With no booking date, it uses the latest rate.
 */
export function valueRate(pricing: Pricing, article: ArticleInput): MetalRate {
  return metalRate(pricing, article.metal, article.karat, article.bookingDate);
}

/**
 * The rate that sets the making charge. A gold piece uses the rate of its purchase date.
 * With no purchase date, it uses the booking date, and then the latest rate.
 */
export function purchaseRate(pricing: Pricing, article: ArticleInput): MetalRate {
  return metalRate(
    pricing,
    article.metal,
    article.karat,
    article.purchaseDate || article.bookingDate,
  );
}

/** Convert a stone weight to grams. */
export function stoneGrams(weight: number, unit: StoneUnit): number {
  return unit === 'ct' ? finite(weight) * GRAMS_PER_CARAT : finite(weight);
}

/** Convert a weight in grams to the given unit. */
function fromGrams(grams: number, unit: StoneUnit): number {
  return unit === 'ct' ? grams / GRAMS_PER_CARAT : grams;
}

/**
 * Fill each stone that uses a shop rate with the kind, unit, and price of that rate.
 *
 * A stone whose rate is no longer on the shop list keeps its last price and becomes a
 * flat-price stone. The function returns the same array, with the same stone objects,
 * when nothing changes. The article card depends on that to reach a fixed point.
 */
export function resolveStones(stones: readonly Stone[], rates: readonly StoneRate[]): Stone[] {
  let changed = false;

  const resolved = stones.map((stone) => {
    if (!stone.rateId) {
      return stone;
    }

    const rate = rates.find((one) => one.id === stone.rateId);
    let next: Stone;

    if (rate) {
      // A stone that just picked a rate may still hold its weight in the other unit.
      const weight =
        stone.unit === rate.unit
          ? stone.weight
          : round(fromGrams(stoneGrams(stone.weight, stone.unit), rate.unit), 4);
      const price = round(finite(weight) * finite(rate.rate), 2);
      next = { ...stone, kind: rate.kind, unit: rate.unit, weight, price };
    } else {
      next = { ...stone, rateId: '' };
    }

    const same =
      next.kind === stone.kind &&
      next.unit === stone.unit &&
      next.rateId === stone.rateId &&
      Object.is(next.weight, stone.weight) &&
      Object.is(next.price, stone.price);

    if (same) {
      return stone;
    }
    changed = true;
    return next;
  });

  return changed ? resolved : (stones as Stone[]);
}

export interface StoneTotals {
  weightGrams: number;
  price: number;
}

/** Add up a list of stones. A piece with no stones gives two zeros. */
export function stoneTotals(stones: readonly Stone[]): StoneTotals {
  return stones.reduce<StoneTotals>(
    (sum, stone) => ({
      weightGrams: sum.weightGrams + stoneGrams(stone.weight, stone.unit),
      price: sum.price + finite(stone.price),
    }),
    { weightGrams: 0, price: 0 },
  );
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function round(value: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}

export interface ArticlePrice {
  /** The rate that sets the metal value. */
  valueRate: MetalRate;
  /** The rate that sets the making charge. */
  purchaseRate: MetalRate;
  metalPrice: number;
  /** The metal weight at the purchase rate. The making charge is a percentage of this. */
  makingBase: number;
  makingCharge: number;
  stonePrice: number;
  priceBeforeTax: number;
  tax: number;
  priceAfterTax: number;
  totalWeightGrams: number;
}

/** The forward calculation, from weight to the price after tax. */
export function computeArticle(article: ArticleInput, pricing: Pricing): ArticlePrice {
  const weight = finite(article.weightGrams);
  const value = valueRate(pricing, article);
  const purchase = purchaseRate(pricing, article);
  const stones = stoneTotals(resolveStones(article.stones, pricing.stoneRates));

  const metalPrice = weight * value.perGram;
  const makingBase = weight * purchase.perGram;
  const makingCharge = (finite(article.makingChargePercent) / 100) * makingBase;
  const priceBeforeTax = metalPrice + makingCharge + stones.price;
  const tax = (priceBeforeTax * finite(pricing.gstPercent)) / 100;

  return {
    valueRate: value,
    purchaseRate: purchase,
    metalPrice,
    makingBase,
    makingCharge,
    stonePrice: stones.price,
    priceBeforeTax,
    tax,
    priceAfterTax: priceBeforeTax + tax,
    totalWeightGrams: weight + stones.weightGrams,
  };
}

export interface Totals {
  count: number;
  metalPrice: number;
  makingCharge: number;
  stonePrice: number;
  priceBeforeTax: number;
  tax: number;
  priceAfterTax: number;
  totalWeightGrams: number;
}

/** The sum over the articles the caller passes in. The caller filters the selection. */
export function computeTotals(articles: readonly ArticleInput[], pricing: Pricing): Totals {
  const empty: Totals = {
    count: 0,
    metalPrice: 0,
    makingCharge: 0,
    stonePrice: 0,
    priceBeforeTax: 0,
    tax: 0,
    priceAfterTax: 0,
    totalWeightGrams: 0,
  };

  return articles.reduce<Totals>((sum, article) => {
    const price = computeArticle(article, pricing);
    return {
      count: sum.count + 1,
      metalPrice: sum.metalPrice + price.metalPrice,
      makingCharge: sum.makingCharge + price.makingCharge,
      stonePrice: sum.stonePrice + price.stonePrice,
      priceBeforeTax: sum.priceBeforeTax + price.priceBeforeTax,
      tax: sum.tax + price.tax,
      priceAfterTax: sum.priceAfterTax + price.priceAfterTax,
      totalWeightGrams: sum.totalWeightGrams + price.totalWeightGrams,
    };
  }, empty);
}

/**
 * The reverse solvers. The user types a price. The app works back to the field that
 * produces that price.
 *
 * The making charge is a percentage of the making base, which is the metal weight at
 * the purchase rate. For a booked piece the making base and the metal price differ. The last
 * three solvers divide by the making base. A zero base makes them undefined, so each one
 * returns `null` in that case. The caller keeps the old value and disables the field.
 */

/** The user edits the metal price of the article. The weight follows. */
export function weightFromMetalPrice(metalPrice: number, rate: number): number | null {
  if (!isSolvable(rate)) {
    return null;
  }
  return metalPrice / rate;
}

/** The user edits the making charge amount. The percentage follows. */
export function percentFromMakingCharge(makingCharge: number, makingBase: number): number | null {
  if (!isSolvable(makingBase)) {
    return null;
  }
  return (makingCharge / makingBase) * 100;
}

/**
 * The user edits the price before tax. The percentage follows.
 * The result goes below zero when the typed price sits under the metal cost. The app
 * keeps that value and shows it as a discount.
 */
export function percentFromPriceBeforeTax(
  priceBeforeTax: number,
  metalPrice: number,
  stonePrice: number,
  makingBase: number,
): number | null {
  if (!isSolvable(makingBase)) {
    return null;
  }
  return ((priceBeforeTax - metalPrice - stonePrice) / makingBase) * 100;
}

/** The user edits the price after tax. The tax comes off, then the percentage follows. */
export function percentFromPriceAfterTax(
  priceAfterTax: number,
  metalPrice: number,
  stonePrice: number,
  makingBase: number,
  gstPercent: number,
): number | null {
  return percentFromPriceBeforeTax(
    priceBeforeTax(priceAfterTax, gstPercent),
    metalPrice,
    stonePrice,
    makingBase,
  );
}

/** The price before tax that produces the given price after tax. */
export function priceBeforeTax(priceAfterTax: number, gstPercent: number): number {
  return priceAfterTax / (1 + gstPercent / 100);
}

/** A divisor must be a finite number above zero. */
function isSolvable(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
