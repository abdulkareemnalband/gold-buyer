import { Karat, Stone } from './models';

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

export interface ArticleInput {
  karat: number;
  goldWeightGrams: number;
  makingChargePercent: number;
  /** The weight of every stone on the piece, added together. */
  stoneWeightGrams: number;
  /** The price of every stone on the piece, added together. */
  stonePrice: number;
}

export interface StoneTotals {
  weightGrams: number;
  price: number;
}

/** Add up a list of stones. A piece with no stones gives two zeros. */
export function stoneTotals(stones: readonly Stone[]): StoneTotals {
  return stones.reduce<StoneTotals>(
    (sum, stone) => ({
      weightGrams: sum.weightGrams + finite(stone.weightGrams),
      price: sum.price + finite(stone.price),
    }),
    { weightGrams: 0, price: 0 },
  );
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export interface ArticlePrice {
  ratePerGram: number;
  goldPrice: number;
  makingCharge: number;
  priceBeforeTax: number;
  tax: number;
  priceAfterTax: number;
  totalWeightGrams: number;
}

/** The forward calculation, from weight to the price after tax. */
export function computeArticle(
  article: ArticleInput,
  pricePerGram24: number,
  gstPercent: number,
): ArticlePrice {
  const rate = ratePerGram(pricePerGram24, article.karat);
  const goldPrice = article.goldWeightGrams * rate;
  const makingCharge = (article.makingChargePercent / 100) * goldPrice;
  const priceBeforeTax = goldPrice + makingCharge + article.stonePrice;
  const tax = (priceBeforeTax * gstPercent) / 100;

  return {
    ratePerGram: rate,
    goldPrice,
    makingCharge,
    priceBeforeTax,
    tax,
    priceAfterTax: priceBeforeTax + tax,
    totalWeightGrams: article.goldWeightGrams + article.stoneWeightGrams,
  };
}

export interface Totals {
  count: number;
  goldPrice: number;
  makingCharge: number;
  stonePrice: number;
  priceBeforeTax: number;
  tax: number;
  priceAfterTax: number;
  totalWeightGrams: number;
}

/** The sum over the articles the caller passes in. The caller filters the selection. */
export function computeTotals(
  articles: readonly ArticleInput[],
  pricePerGram24: number,
  gstPercent: number,
): Totals {
  const empty: Totals = {
    count: 0,
    goldPrice: 0,
    makingCharge: 0,
    stonePrice: 0,
    priceBeforeTax: 0,
    tax: 0,
    priceAfterTax: 0,
    totalWeightGrams: 0,
  };

  return articles.reduce<Totals>((sum, article) => {
    const price = computeArticle(article, pricePerGram24, gstPercent);
    return {
      count: sum.count + 1,
      goldPrice: sum.goldPrice + price.goldPrice,
      makingCharge: sum.makingCharge + price.makingCharge,
      stonePrice: sum.stonePrice + article.stonePrice,
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
 * The last three divide by the gold price. A zero gold price makes them undefined, so
 * each one returns `null` in that case. The caller keeps the old value and disables the
 * field.
 */

/** The user edits the gold price of the article. The gold weight follows. */
export function weightFromGoldPrice(goldPrice: number, rate: number): number | null {
  if (!isSolvable(rate)) {
    return null;
  }
  return goldPrice / rate;
}

/** The user edits the making charge amount. The percentage follows. */
export function percentFromMakingCharge(makingCharge: number, goldPrice: number): number | null {
  if (!isSolvable(goldPrice)) {
    return null;
  }
  return (makingCharge / goldPrice) * 100;
}

/**
 * The user edits the price before tax. The percentage follows.
 * The result goes below zero when the typed price sits under the metal cost. The app
 * keeps that value and shows it as a discount.
 */
export function percentFromPriceBeforeTax(
  priceBeforeTax: number,
  goldPrice: number,
  stonePrice: number,
): number | null {
  if (!isSolvable(goldPrice)) {
    return null;
  }
  return ((priceBeforeTax - goldPrice - stonePrice) / goldPrice) * 100;
}

/** The user edits the price after tax. The tax comes off, then the percentage follows. */
export function percentFromPriceAfterTax(
  priceAfterTax: number,
  goldPrice: number,
  stonePrice: number,
  gstPercent: number,
): number | null {
  return percentFromPriceBeforeTax(priceBeforeTax(priceAfterTax, gstPercent), goldPrice, stonePrice);
}

/** The price before tax that produces the given price after tax. */
export function priceBeforeTax(priceAfterTax: number, gstPercent: number): number {
  return priceAfterTax / (1 + gstPercent / 100);
}

/** A divisor must be a finite number above zero. */
function isSolvable(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
