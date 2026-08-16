import { describe, expect, it } from 'vitest';
import {
  ArticleInput,
  computeArticle,
  computeTotals,
  percentFromMakingCharge,
  percentFromPriceAfterTax,
  percentFromPriceBeforeTax,
  price24From,
  priceBeforeTax,
  ratePerGram,
  weightFromGoldPrice,
} from './gold-math';

const GST = 3;

/** A 10 g 22kt piece at a 24kt rate of 7200, with a 12% making charge and a stone. */
const PIECE: ArticleInput = {
  karat: 22,
  goldWeightGrams: 10,
  makingChargePercent: 12,
  stoneWeightGrams: 0.4,
  stonePrice: 5000,
};

describe('ratePerGram', () => {
  it('returns the 24kt rate unchanged', () => {
    expect(ratePerGram(7200, 24)).toBe(7200);
  });

  it('scales the rate down for 22kt and 18kt', () => {
    expect(ratePerGram(7200, 22)).toBe(6600);
    expect(ratePerGram(7200, 18)).toBe(5400);
  });
});

describe('price24From', () => {
  it('reverses ratePerGram for every karat', () => {
    for (const karat of [24, 22, 18] as const) {
      expect(price24From(ratePerGram(7200, karat), karat)).toBeCloseTo(7200, 9);
    }
  });

  it('lifts a typed 22kt rate to its 24kt equal', () => {
    expect(price24From(6600, 22)).toBe(7200);
  });
});

describe('computeArticle', () => {
  it('runs the forward chain', () => {
    const price = computeArticle(PIECE, 7200, GST);

    expect(price.ratePerGram).toBe(6600);
    expect(price.goldPrice).toBe(66000);
    expect(price.makingCharge).toBe(7920);
    expect(price.priceBeforeTax).toBe(78920);
    expect(price.tax).toBeCloseTo(2367.6, 6);
    expect(price.priceAfterTax).toBeCloseTo(81287.6, 6);
  });

  it('adds the stone weight into the total weight only', () => {
    const price = computeArticle(PIECE, 7200, GST);

    expect(price.totalWeightGrams).toBe(10.4);
    expect(price.goldPrice).toBe(10 * 6600);
  });

  it('returns zero prices for a zero rate', () => {
    const price = computeArticle(PIECE, 0, GST);

    expect(price.goldPrice).toBe(0);
    expect(price.makingCharge).toBe(0);
    expect(price.priceBeforeTax).toBe(5000);
  });
});

describe('computeTotals', () => {
  it('sums every article it receives', () => {
    const one = computeArticle(PIECE, 7200, GST);
    const totals = computeTotals([PIECE, PIECE], 7200, GST);

    expect(totals.count).toBe(2);
    expect(totals.priceBeforeTax).toBeCloseTo(one.priceBeforeTax * 2, 6);
    expect(totals.priceAfterTax).toBeCloseTo(one.priceAfterTax * 2, 6);
    expect(totals.totalWeightGrams).toBeCloseTo(20.8, 6);
  });

  it('returns zeros for an empty selection', () => {
    const totals = computeTotals([], 7200, GST);

    expect(totals.count).toBe(0);
    expect(totals.priceAfterTax).toBe(0);
  });
});

describe('weightFromGoldPrice', () => {
  it('reverses the gold price back to the weight', () => {
    expect(weightFromGoldPrice(66000, 6600)).toBe(10);
  });

  it('returns null for a zero rate', () => {
    expect(weightFromGoldPrice(66000, 0)).toBeNull();
  });
});

describe('percentFromMakingCharge', () => {
  it('reverses the making charge back to the percentage', () => {
    expect(percentFromMakingCharge(7920, 66000)).toBeCloseTo(12, 9);
  });

  it('returns null for a zero gold price', () => {
    expect(percentFromMakingCharge(7920, 0)).toBeNull();
  });
});

describe('percentFromPriceBeforeTax', () => {
  it('reverses the price before tax back to the percentage', () => {
    expect(percentFromPriceBeforeTax(78920, 66000, 5000)).toBeCloseTo(12, 9);
  });

  it('goes below zero when the price sits under the metal cost', () => {
    const percent = percentFromPriceBeforeTax(70000, 66000, 5000);

    expect(percent).not.toBeNull();
    expect(percent!).toBeLessThan(0);
    expect(percent!).toBeCloseTo((-1000 / 66000) * 100, 9);
  });

  it('returns null for a zero gold price', () => {
    expect(percentFromPriceBeforeTax(78920, 0, 5000)).toBeNull();
  });
});

describe('percentFromPriceAfterTax', () => {
  it('takes the tax off, then reverses to the percentage', () => {
    const percent = percentFromPriceAfterTax(81287.6, 66000, 5000, GST);

    expect(percent).not.toBeNull();
    expect(percent!).toBeCloseTo(12, 6);
  });

  it('returns null for a zero gold price', () => {
    expect(percentFromPriceAfterTax(81287.6, 0, 5000, GST)).toBeNull();
  });
});

describe('priceBeforeTax', () => {
  it('reverses the tax step', () => {
    expect(priceBeforeTax(103, 3)).toBeCloseTo(100, 9);
  });
});

describe('round trips', () => {
  it('returns the same price after every reverse solver feeds the forward chain', () => {
    const price = computeArticle(PIECE, 7200, GST);

    const weight = weightFromGoldPrice(price.goldPrice, price.ratePerGram);
    expect(weight).toBeCloseTo(PIECE.goldWeightGrams, 9);

    const fromMaking = percentFromMakingCharge(price.makingCharge, price.goldPrice);
    expect(fromMaking).toBeCloseTo(PIECE.makingChargePercent, 9);

    const fromBefore = percentFromPriceBeforeTax(
      price.priceBeforeTax,
      price.goldPrice,
      PIECE.stonePrice,
    );
    expect(fromBefore).toBeCloseTo(PIECE.makingChargePercent, 9);

    const fromAfter = percentFromPriceAfterTax(
      price.priceAfterTax,
      price.goldPrice,
      PIECE.stonePrice,
      GST,
    );
    expect(fromAfter).toBeCloseTo(PIECE.makingChargePercent, 9);
  });
});
