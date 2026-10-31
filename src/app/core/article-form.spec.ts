import { describe, expect, it } from 'vitest';
import {
  ArticleForm,
  articleToForm,
  changedDerivedKey,
  formToArticlePatch,
  reconcile,
  sameForm,
  sameSource,
} from './article-form';
import { Pricing } from './gold-math';
import { Article, Stone } from './models';

const GST = 3;

const PRICING: Pricing = {
  goldRates: [{ id: 'g1', date: '2026-10-31', karat: 24, rate: 7200 }],
  silverPricePerGram: 0,
  platinumPricePerGram: 0,
  gstPercent: GST,
  stoneRates: [],
};

const RUBY: Stone = { id: 's1', kind: 'Ruby', rateId: '', weight: 0.4, unit: 'g', price: 5000 };

const ARTICLE: Article = {
  id: 'a1',
  collectionId: 'c1',
  name: 'Bangle',
  notes: '',
  barcode: { data: '', type: 'code128' },
  metal: 'gold',
  karat: 22,
  weightGrams: 10,
  makingChargePercent: 12,
  makingDiscountPercent: 0,
  bookingDate: '',
  purchaseDate: '',
  stones: [RUBY],
  selected: true,
  createdAt: 0,
};

function baseForm(): ArticleForm {
  return articleToForm(ARTICLE, PRICING);
}

/** One pass, as the card's effect runs it. */
function pass(previous: ArticleForm, next: ArticleForm): ArticleForm {
  return reconcile(previous, next, PRICING);
}

describe('articleToForm', () => {
  it('fills the derived fields from the source fields', () => {
    const form = baseForm();

    expect(form.metalPrice).toBe(66000);
    expect(form.makingCharge).toBe(7920);
    expect(form.priceBeforeTax).toBe(78920);
    expect(form.priceAfterTax).toBe(81287.6);
  });
});

describe('reconcile with no change', () => {
  it('reaches a fixed point after one pass', () => {
    const form = baseForm();

    expect(sameForm(pass(form, form), form)).toBe(true);
  });
});

describe('reconcile after a source edit', () => {
  it('recomputes every derived field when the weight changes', () => {
    const form = baseForm();
    const result = pass(form, { ...form, weightGrams: 20 });

    expect(result.metalPrice).toBe(132000);
    expect(result.makingCharge).toBe(15840);
    expect(result.priceBeforeTax).toBe(152840);
  });

  it('recomputes every derived field when the karat changes', () => {
    const form = baseForm();
    const result = pass(form, { ...form, karat: 18 });

    expect(result.metalPrice).toBe(54000);
  });

  it('leaves the gold price alone when only the stone weight changes', () => {
    const form = baseForm();
    const result = pass(form, { ...form, stones: [{ ...RUBY, weight: 2 }] });

    expect(result.metalPrice).toBe(66000);
    expect(result.priceBeforeTax).toBe(78920);
  });

  it('moves the price before tax when the stone price changes', () => {
    const form = baseForm();
    const result = pass(form, { ...form, stones: [{ ...RUBY, price: 6000 }] });

    expect(result.priceBeforeTax).toBe(79920);
  });
});

describe('reconcile with any number of stones', () => {
  it('prices a piece with no stones at all', () => {
    const plain = articleToForm({ ...ARTICLE, stones: [] }, PRICING);

    expect(plain.priceBeforeTax).toBe(73920);
    expect(plain.priceAfterTax).toBeCloseTo(73920 * 1.03, 2);
  });

  it('adds up several stones', () => {
    const many = articleToForm(
      {
        ...ARTICLE,
        stones: [
          RUBY,
          { id: 's2', kind: 'Diamond', rateId: '', weight: 0.2, unit: 'g', price: 20000 },
          { id: 's3', kind: 'Emerald', rateId: '', weight: 0.1, unit: 'g', price: 3000 },
        ],
      },
      PRICING,
    );

    expect(many.priceBeforeTax).toBe(66000 + 7920 + 28000);
  });

  it('solves the making charge against every stone price together', () => {
    const many = articleToForm(
      {
        ...ARTICLE,
        stones: [
          RUBY,
          { id: 's2', kind: 'Diamond', rateId: '', weight: 0.2, unit: 'g', price: 5000 },
        ],
      },
      PRICING,
    );
    const result = pass(many, { ...many, priceBeforeTax: 89200 });

    expect(result.makingChargePercent).toBe(20);
  });
});

describe('reconcile after a metal price edit', () => {
  it('solves the gold weight', () => {
    const form = baseForm();
    const result = pass(form, { ...form, metalPrice: 33000 });

    expect(result.weightGrams).toBe(5);
  });

  it('keeps the typed number exactly as typed', () => {
    const form = baseForm();
    const result = pass(form, { ...form, metalPrice: 50000 });

    expect(result.metalPrice).toBe(50000);
    expect(result.weightGrams).toBeCloseTo(50000 / 6600, 4);
  });

  it('settles on the second pass, inside half a rupee', () => {
    const form = baseForm();
    const first = pass(form, { ...form, metalPrice: 50000 });
    const second = pass(first, first);

    expect(second.weightGrams).toBe(first.weightGrams);
    // The weight rounds to 4 decimal places, which is a tenth of a milligram. At a rate
    // near 6600 that step is worth about 66 paise, so the price can move by up to half a
    // rupee once the typed number gives way to the stored weight.
    expect(second.metalPrice).toBeCloseTo(50000, 0);
  });
});

describe('reconcile after a making charge edit', () => {
  it('solves the making charge percentage', () => {
    const form = baseForm();
    const result = pass(form, { ...form, makingCharge: 13200 });

    expect(result.makingChargePercent).toBe(20);
    expect(result.priceBeforeTax).toBe(84200);
  });
});

describe('reconcile after a price before tax edit', () => {
  it('solves the making charge percentage', () => {
    const form = baseForm();
    const result = pass(form, { ...form, priceBeforeTax: 84200 });

    expect(result.makingChargePercent).toBe(20);
    expect(result.makingCharge).toBe(13200);
    expect(result.priceBeforeTax).toBe(84200);
  });

  it('goes negative and marks a discount below the metal cost', () => {
    const form = baseForm();
    const result = pass(form, { ...form, priceBeforeTax: 70000 });

    expect(result.makingChargePercent).toBeLessThan(0);
    expect(result.makingCharge).toBeLessThan(0);
  });
});

describe('reconcile after a price after tax edit', () => {
  it('takes the tax off, then solves the percentage', () => {
    const form = baseForm();
    const result = pass(form, { ...form, priceAfterTax: 86726 });

    expect(result.priceBeforeTax).toBeCloseTo(86726 / 1.03, 2);
    expect(result.makingChargePercent).toBeCloseTo(20, 2);
  });
});

describe('reconcile with a zero metal price', () => {
  it('keeps the source fields when no solver can divide', () => {
    const empty = articleToForm({ ...ARTICLE, weightGrams: 0 }, PRICING);
    const result = pass(empty, { ...empty, priceBeforeTax: 9000 });

    expect(result.makingChargePercent).toBe(ARTICLE.makingChargePercent);
  });

  it('still prices the stones on their own', () => {
    const empty = articleToForm({ ...ARTICLE, weightGrams: 0 }, PRICING);

    expect(empty.priceBeforeTax).toBe(5000);
  });
});

describe('reconcile with an unparsed field', () => {
  it('waits for the next keystroke instead of forcing a zero', () => {
    const form = baseForm();
    const result = pass(form, { ...form, metalPrice: Number.NaN });

    expect(result.weightGrams).toBe(10);
    expect(Number.isNaN(result.metalPrice)).toBe(true);
  });

  it('treats an unparsed weight as zero for the price only', () => {
    const form = baseForm();
    const result = pass(form, { ...form, weightGrams: Number.NaN });

    expect(result.metalPrice).toBe(0);
    expect(Number.isNaN(result.weightGrams)).toBe(true);
  });
});

describe('reconcile after a rate change', () => {
  it('reprices from the weight, not from the old gold price', () => {
    const form = baseForm();
    const result = reconcile(form, form, {
      ...PRICING,
      goldRates: [{ id: 'g2', date: '2026-11-01', karat: 24, rate: 7800 }],
    });

    expect(result.metalPrice).toBe(71500);
    expect(result.weightGrams).toBe(10);
  });
});

describe('any karat', () => {
  it('prices a karat that the rate board does not list', () => {
    const odd = articleToForm({ ...ARTICLE, karat: 21, stones: [] }, PRICING);

    expect(odd.metalPrice).toBe(63000);
    expect(odd.makingCharge).toBe(7560);
  });

  it('prices a low karat', () => {
    const nine = articleToForm({ ...ARTICLE, karat: 9, stones: [] }, PRICING);

    expect(nine.metalPrice).toBe(27000);
  });

  it('reprices when the karat changes', () => {
    const form = baseForm();
    const result = pass(form, { ...form, karat: 20 });

    expect(result.metalPrice).toBe(60000);
  });
});

describe('changedDerivedKey and sameSource', () => {
  it('names the derived field the user typed in', () => {
    const form = baseForm();

    expect(changedDerivedKey(form, { ...form, priceAfterTax: 90000 })).toBe('priceAfterTax');
    expect(changedDerivedKey(form, form)).toBeNull();
  });

  it('ignores a derived change when it looks at the source', () => {
    const form = baseForm();

    expect(sameSource(form, { ...form, priceAfterTax: 90000 })).toBe(true);
  });

  it('reports a source change, including one inside a stone', () => {
    const form = baseForm();

    expect(sameSource(form, { ...form, weightGrams: 11 })).toBe(false);
    expect(sameSource(form, { ...form, karat: 21 })).toBe(false);
    expect(sameSource(form, { ...form, stones: [{ ...RUBY, price: 1 }] })).toBe(false);
    expect(sameSource(form, { ...form, stones: [] })).toBe(false);
  });
});

describe('formToArticlePatch', () => {
  it('returns the source fields only', () => {
    const patch = formToArticlePatch(baseForm());

    expect(patch).toEqual({
      name: 'Bangle',
      notes: '',
      barcode: { data: '', type: 'code128' },
      metal: 'gold',
      karat: 22,
      weightGrams: 10,
      makingChargePercent: 12,
      makingDiscountPercent: 0,
      bookingDate: '',
      purchaseDate: '',
      stones: [RUBY],
      selected: true,
    });
  });

  it('turns an unparsed stone field into a zero for the store', () => {
    const form = baseForm();
    const patch = formToArticlePatch({
      ...form,
      stones: [{ ...RUBY, price: Number.NaN }],
    });

    expect(patch.stones?.[0].price).toBe(0);
  });

  it('turns an unparsed field into a zero for the store', () => {
    const patch = formToArticlePatch({ ...baseForm(), weightGrams: Number.NaN });

    expect(patch.weightGrams).toBe(0);
  });
});

describe('reconcile with a booking date', () => {
  const DATED: Pricing = {
    ...PRICING,
    goldRates: [...PRICING.goldRates, { id: 'g0', date: '2026-01-10', karat: 24, rate: 6000 }],
  };

  it('solves the percentage against the making charge at the purchase rate', () => {
    const form = articleToForm(
      { ...ARTICLE, bookingDate: '2026-01-10', purchaseDate: '2026-10-31' },
      DATED,
    );

    expect(form.metalPrice).toBe(55000);
    expect(form.makingCharge).toBe(7920);

    const result = reconcile(form, { ...form, makingCharge: 13200 }, DATED);
    expect(result.makingChargePercent).toBe(20);
  });
});

describe('reconcile with a making discount', () => {
  it('solves the making charge percentage before the discount', () => {
    const form = articleToForm({ ...ARTICLE, makingDiscountPercent: 50 }, PRICING);

    expect(form.makingCharge).toBe(3960);

    const result = reconcile(form, { ...form, makingCharge: 6600 }, PRICING);
    expect(result.makingChargePercent).toBe(20);
  });
});

describe('reconcile with a shop stone rate', () => {
  const RATED: Pricing = {
    ...PRICING,
    stoneRates: [{ id: 'r1', kind: 'Diamond', unit: 'ct', rate: 50000 }],
  };

  it('prices the stone from the rate after the user picks it', () => {
    const form = articleToForm(ARTICLE, RATED);
    const result = reconcile(
      form,
      { ...form, stones: [{ ...RUBY, rateId: 'r1', weight: 0.5, unit: 'ct' }] },
      RATED,
    );

    expect(result.stones[0].kind).toBe('Diamond');
    expect(result.stones[0].price).toBe(25000);
    expect(result.priceBeforeTax).toBe(66000 + 7920 + 25000);
  });

  it('reaches a fixed point after the stone resolves', () => {
    const form = articleToForm(
      { ...ARTICLE, stones: [{ ...RUBY, rateId: 'r1', weight: 0.5, unit: 'ct' }] },
      RATED,
    );

    expect(sameForm(reconcile(form, form, RATED), form)).toBe(true);
  });
});
