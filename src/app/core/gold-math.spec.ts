import { describe, expect, it } from 'vitest';
import {
  ArticleInput,
  computeArticle,
  computeTotals,
  goldRateOn,
  latestGoldRate,
  percentFromMakingCharge,
  percentFromPriceAfterTax,
  percentFromPriceBeforeTax,
  price24From,
  priceBeforeTax,
  Pricing,
  rate24,
  ratePerGram,
  resolveStones,
  stoneTotals,
  weightFromMetalPrice,
} from './gold-math';
import { GoldRate, Stone } from './models';

const GST = 3;

const PRICING: Pricing = {
  goldRates: [{ id: 'g1', date: '2026-10-31', karat: 24, rate: 7200 }],
  silverPricePerGram: 90,
  platinumPricePerGram: 3000,
  gstPercent: GST,
  stoneRates: [],
};

const RUBY: Stone = { id: 's1', kind: 'Ruby', rateId: '', weight: 0.4, unit: 'g', price: 5000 };

/** A 10 g 22kt piece at a 24kt rate of 7200, with a 12% making charge and a stone. */
const PIECE: ArticleInput = {
  metal: 'gold',
  karat: 22,
  weightGrams: 10,
  makingChargePercent: 12,
  makingDiscountPercent: 0,
  makingOnStones: false,
  bookingDate: '',
  purchaseDate: '',
  stones: [RUBY],
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
    const price = computeArticle(PIECE, PRICING);

    expect(price.valueRate.perGram).toBe(6600);
    expect(price.metalPrice).toBe(66000);
    expect(price.makingCharge).toBe(7920);
    expect(price.priceBeforeTax).toBe(78920);
    expect(price.tax).toBeCloseTo(2367.6, 6);
    expect(price.priceAfterTax).toBeCloseTo(81287.6, 6);
  });

  it('adds the stone weight into the total weight only', () => {
    const price = computeArticle(PIECE, PRICING);

    expect(price.totalWeightGrams).toBe(10.4);
    expect(price.metalPrice).toBe(10 * 6600);
  });

  it('returns zero prices for a zero rate', () => {
    const price = computeArticle(PIECE, { ...PRICING, goldRates: [] });

    expect(price.metalPrice).toBe(0);
    expect(price.makingCharge).toBe(0);
    expect(price.priceBeforeTax).toBe(5000);
  });

  it('prices silver and platinum at their own rates, with no karat', () => {
    const silver = computeArticle({ ...PIECE, metal: 'silver', stones: [] }, PRICING);
    const platinum = computeArticle({ ...PIECE, metal: 'platinum', stones: [] }, PRICING);

    expect(silver.metalPrice).toBe(900);
    expect(silver.makingCharge).toBe(108);
    expect(platinum.metalPrice).toBe(30000);
  });
});

describe('dated gold rates', () => {
  const RATES: GoldRate[] = [
    { id: 'a', date: '2026-01-10', karat: 24, rate: 6000 },
    { id: 'b', date: '2026-06-01', karat: 22, rate: 6050 },
    { id: 'c', date: '2026-10-31', karat: 24, rate: 7200 },
  ];
  const DATED: Pricing = { ...PRICING, goldRates: RATES };

  it('lifts a rate typed in any karat to 24kt', () => {
    expect(rate24(RATES[1])).toBeCloseTo(6600, 9);
  });

  it('finds the latest rate, and the rate on or before a day', () => {
    expect(latestGoldRate(RATES)?.id).toBe('c');
    expect(goldRateOn(RATES, '')?.id).toBe('c');
    expect(goldRateOn(RATES, '2026-06-01')?.id).toBe('b');
    expect(goldRateOn(RATES, '2026-07-15')?.id).toBe('b');
    expect(goldRateOn(RATES, '2025-12-31')?.id).toBe('a');
  });

  it('uses the latest rate for both parts when no date is set', () => {
    const price = computeArticle(PIECE, DATED);

    expect(price.metalPrice).toBe(66000);
    expect(price.makingCharge).toBe(7920);
  });

  it('takes the metal value from the booking date and the making charge from the purchase date', () => {
    const price = computeArticle(
      { ...PIECE, bookingDate: '2026-01-10', purchaseDate: '2026-10-31' },
      DATED,
    );

    expect(price.valueRate.perGram).toBe(5500);
    expect(price.purchaseRate.perGram).toBe(6600);
    expect(price.metalPrice).toBe(55000);
    expect(price.makingBase).toBe(66000);
    expect(price.makingCharge).toBe(7920);
  });

  it('uses the booking date for the making charge when the purchase date is not set', () => {
    const price = computeArticle({ ...PIECE, bookingDate: '2026-01-10' }, DATED);

    expect(price.purchaseRate.date).toBe('2026-01-10');
    expect(price.makingCharge).toBeCloseTo(0.12 * 55000, 9);
  });

  it('ignores the dates for silver', () => {
    const price = computeArticle(
      { ...PIECE, metal: 'silver', bookingDate: '2026-01-10', stones: [] },
      DATED,
    );

    expect(price.metalPrice).toBe(900);
  });

  it('solves the percentage against the making base, not the booked value', () => {
    const price = computeArticle(
      { ...PIECE, bookingDate: '2026-01-10', purchaseDate: '2026-10-31' },
      DATED,
    );
    const percent = percentFromPriceBeforeTax(
      price.priceBeforeTax,
      price.metalPrice,
      price.stonePrice,
      price.makingBase,
    );

    expect(percent).toBeCloseTo(12, 9);
  });
});

describe('a discount on the making charge', () => {
  it('takes the discount off the making charge only', () => {
    const price = computeArticle({ ...PIECE, makingDiscountPercent: 25 }, PRICING);

    expect(price.grossMakingCharge).toBe(7920);
    expect(price.makingDiscount).toBe(1980);
    expect(price.makingCharge).toBe(5940);
    expect(price.metalPrice).toBe(66000);
    expect(price.priceBeforeTax).toBe(66000 + 5940 + 5000);
  });

  it('keeps the discount from 0 to 100%', () => {
    expect(computeArticle({ ...PIECE, makingDiscountPercent: 150 }, PRICING).makingCharge).toBe(0);
    expect(computeArticle({ ...PIECE, makingDiscountPercent: -10 }, PRICING).makingCharge).toBe(
      7920,
    );
  });

  it('solves the percentage against the net making base', () => {
    const price = computeArticle({ ...PIECE, makingDiscountPercent: 25 }, PRICING);

    expect(percentFromMakingCharge(price.makingCharge, price.netMakingBase)).toBeCloseTo(12, 9);
  });
});

describe('a making charge on the stone price', () => {
  it('adds the stone price to the making base', () => {
    const price = computeArticle({ ...PIECE, makingOnStones: true }, PRICING);

    expect(price.makingBase).toBe(66000 + 5000);
    expect(price.makingCharge).toBe(8520);
    expect(price.priceBeforeTax).toBe(66000 + 8520 + 5000);
  });

  it('takes the discount off the whole base', () => {
    const price = computeArticle(
      { ...PIECE, makingOnStones: true, makingDiscountPercent: 50 },
      PRICING,
    );

    expect(price.makingCharge).toBe(4260);
  });

  it('changes nothing for a piece with no stones', () => {
    const plain = { ...PIECE, stones: [] };

    expect(computeArticle({ ...plain, makingOnStones: true }, PRICING)).toEqual(
      computeArticle(plain, PRICING),
    );
  });

  it('solves the percentage from the price after tax', () => {
    const price = computeArticle({ ...PIECE, makingOnStones: true }, PRICING);
    const percent = percentFromPriceAfterTax(
      price.priceAfterTax,
      price.metalPrice,
      price.stonePrice,
      price.netMakingBase,
      GST,
    );

    expect(percent).toBeCloseTo(12, 9);
  });
});

describe('stones', () => {
  it('weighs a carat stone at 0.2 g', () => {
    const totals = stoneTotals([{ ...RUBY, weight: 2, unit: 'ct' }]);

    expect(totals.weightGrams).toBeCloseTo(0.4, 9);
  });

  it('prices a stone from its shop rate', () => {
    const rates = [{ id: 'r1', kind: 'Diamond', unit: 'ct' as const, rate: 50000 }];
    const [stone] = resolveStones([{ ...RUBY, rateId: 'r1', weight: 0.5, unit: 'ct' }], rates);

    expect(stone.kind).toBe('Diamond');
    expect(stone.price).toBe(25000);
  });

  it('converts the weight when the stone picks a rate in the other unit', () => {
    const rates = [{ id: 'r1', kind: 'Diamond', unit: 'ct' as const, rate: 50000 }];
    const [stone] = resolveStones([{ ...RUBY, rateId: 'r1', weight: 0.2, unit: 'g' }], rates);

    expect(stone.unit).toBe('ct');
    expect(stone.weight).toBe(1);
    expect(stone.price).toBe(50000);
  });

  it('keeps the last price when the rate is gone', () => {
    const [stone] = resolveStones([{ ...RUBY, rateId: 'gone' }], []);

    expect(stone.rateId).toBe('');
    expect(stone.price).toBe(5000);
  });

  it('returns the same array when nothing changes', () => {
    const stones = [RUBY];

    expect(resolveStones(stones, [])).toBe(stones);
  });
});

describe('computeTotals', () => {
  it('sums every article it receives', () => {
    const one = computeArticle(PIECE, PRICING);
    const totals = computeTotals([PIECE, PIECE], PRICING);

    expect(totals.count).toBe(2);
    expect(totals.priceBeforeTax).toBeCloseTo(one.priceBeforeTax * 2, 6);
    expect(totals.priceAfterTax).toBeCloseTo(one.priceAfterTax * 2, 6);
    expect(totals.totalWeightGrams).toBeCloseTo(20.8, 6);
  });

  it('returns zeros for an empty selection', () => {
    const totals = computeTotals([], PRICING);

    expect(totals.count).toBe(0);
    expect(totals.priceAfterTax).toBe(0);
  });
});

describe('weightFromMetalPrice', () => {
  it('reverses the metal price back to the weight', () => {
    expect(weightFromMetalPrice(66000, 6600)).toBe(10);
  });

  it('returns null for a zero rate', () => {
    expect(weightFromMetalPrice(66000, 0)).toBeNull();
  });
});

describe('percentFromMakingCharge', () => {
  it('reverses the making charge back to the percentage', () => {
    expect(percentFromMakingCharge(7920, 66000)).toBeCloseTo(12, 9);
  });

  it('returns null for a zero making base', () => {
    expect(percentFromMakingCharge(7920, 0)).toBeNull();
  });
});

describe('percentFromPriceBeforeTax', () => {
  it('reverses the price before tax back to the percentage', () => {
    expect(percentFromPriceBeforeTax(78920, 66000, 5000, 66000)).toBeCloseTo(12, 9);
  });

  it('goes below zero when the price sits under the metal cost', () => {
    const percent = percentFromPriceBeforeTax(70000, 66000, 5000, 66000);

    expect(percent).not.toBeNull();
    expect(percent!).toBeLessThan(0);
    expect(percent!).toBeCloseTo((-1000 / 66000) * 100, 9);
  });

  it('returns null for a zero making base', () => {
    expect(percentFromPriceBeforeTax(78920, 0, 5000, 0)).toBeNull();
  });
});

describe('percentFromPriceAfterTax', () => {
  it('takes the tax off, then reverses to the percentage', () => {
    const percent = percentFromPriceAfterTax(81287.6, 66000, 5000, 66000, GST);

    expect(percent).not.toBeNull();
    expect(percent!).toBeCloseTo(12, 6);
  });

  it('returns null for a zero making base', () => {
    expect(percentFromPriceAfterTax(81287.6, 0, 5000, 0, GST)).toBeNull();
  });
});

describe('priceBeforeTax', () => {
  it('reverses the tax step', () => {
    expect(priceBeforeTax(103, 3)).toBeCloseTo(100, 9);
  });
});

describe('round trips', () => {
  it('returns the same price after every reverse solver feeds the forward chain', () => {
    const price = computeArticle(PIECE, PRICING);

    const weight = weightFromMetalPrice(price.metalPrice, price.valueRate.perGram);
    expect(weight).toBeCloseTo(PIECE.weightGrams, 9);

    const fromMaking = percentFromMakingCharge(price.makingCharge, price.makingBase);
    expect(fromMaking).toBeCloseTo(PIECE.makingChargePercent, 9);

    const fromBefore = percentFromPriceBeforeTax(
      price.priceBeforeTax,
      price.metalPrice,
      price.stonePrice,
      price.makingBase,
    );
    expect(fromBefore).toBeCloseTo(PIECE.makingChargePercent, 9);

    const fromAfter = percentFromPriceAfterTax(
      price.priceAfterTax,
      price.metalPrice,
      price.stonePrice,
      price.makingBase,
      GST,
    );
    expect(fromAfter).toBeCloseTo(PIECE.makingChargePercent, 9);
  });
});
