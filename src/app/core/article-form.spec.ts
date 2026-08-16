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
import { Article, Stone } from './models';

const GST = 3;
const PRICE_24 = 7200;

const RUBY: Stone = { id: 's1', kind: 'Ruby', weightGrams: 0.4, price: 5000 };

const ARTICLE: Article = {
  id: 'a1',
  collectionId: 'c1',
  name: 'Bangle',
  notes: '',
  karat: 22,
  goldWeightGrams: 10,
  makingChargePercent: 12,
  stones: [RUBY],
  selected: true,
  createdAt: 0,
};

function baseForm(): ArticleForm {
  return articleToForm(ARTICLE, PRICE_24, GST);
}

/** One pass, as the card's effect runs it. */
function pass(previous: ArticleForm, next: ArticleForm): ArticleForm {
  return reconcile(previous, next, PRICE_24, GST);
}

describe('articleToForm', () => {
  it('fills the derived fields from the source fields', () => {
    const form = baseForm();

    expect(form.goldPrice).toBe(66000);
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
    const result = pass(form, { ...form, goldWeightGrams: 20 });

    expect(result.goldPrice).toBe(132000);
    expect(result.makingCharge).toBe(15840);
    expect(result.priceBeforeTax).toBe(152840);
  });

  it('recomputes every derived field when the karat changes', () => {
    const form = baseForm();
    const result = pass(form, { ...form, karat: 18 });

    expect(result.goldPrice).toBe(54000);
  });

  it('leaves the gold price alone when only the stone weight changes', () => {
    const form = baseForm();
    const result = pass(form, { ...form, stones: [{ ...RUBY, weightGrams: 2 }] });

    expect(result.goldPrice).toBe(66000);
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
    const plain = articleToForm({ ...ARTICLE, stones: [] }, PRICE_24, GST);

    expect(plain.priceBeforeTax).toBe(73920);
    expect(plain.priceAfterTax).toBeCloseTo(73920 * 1.03, 2);
  });

  it('adds up several stones', () => {
    const many = articleToForm(
      {
        ...ARTICLE,
        stones: [
          RUBY,
          { id: 's2', kind: 'Diamond', weightGrams: 0.2, price: 20000 },
          { id: 's3', kind: 'Emerald', weightGrams: 0.1, price: 3000 },
        ],
      },
      PRICE_24,
      GST,
    );

    expect(many.priceBeforeTax).toBe(66000 + 7920 + 28000);
  });

  it('solves the making charge against every stone price together', () => {
    const many = articleToForm(
      { ...ARTICLE, stones: [RUBY, { id: 's2', kind: 'Diamond', weightGrams: 0.2, price: 5000 }] },
      PRICE_24,
      GST,
    );
    const result = pass(many, { ...many, priceBeforeTax: 89200 });

    expect(result.makingChargePercent).toBe(20);
  });
});

describe('reconcile after a gold price edit', () => {
  it('solves the gold weight', () => {
    const form = baseForm();
    const result = pass(form, { ...form, goldPrice: 33000 });

    expect(result.goldWeightGrams).toBe(5);
  });

  it('keeps the typed number exactly as typed', () => {
    const form = baseForm();
    const result = pass(form, { ...form, goldPrice: 50000 });

    expect(result.goldPrice).toBe(50000);
    expect(result.goldWeightGrams).toBeCloseTo(50000 / 6600, 4);
  });

  it('settles on the second pass, inside half a rupee', () => {
    const form = baseForm();
    const first = pass(form, { ...form, goldPrice: 50000 });
    const second = pass(first, first);

    expect(second.goldWeightGrams).toBe(first.goldWeightGrams);
    // The weight rounds to 4 decimal places, which is a tenth of a milligram. At a rate
    // near 6600 that step is worth about 66 paise, so the price can move by up to half a
    // rupee once the typed number gives way to the stored weight.
    expect(second.goldPrice).toBeCloseTo(50000, 0);
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

describe('reconcile with a zero gold price', () => {
  it('keeps the source fields when no solver can divide', () => {
    const empty = articleToForm({ ...ARTICLE, goldWeightGrams: 0 }, PRICE_24, GST);
    const result = pass(empty, { ...empty, priceBeforeTax: 9000 });

    expect(result.makingChargePercent).toBe(ARTICLE.makingChargePercent);
  });

  it('still prices the stones on their own', () => {
    const empty = articleToForm({ ...ARTICLE, goldWeightGrams: 0 }, PRICE_24, GST);

    expect(empty.priceBeforeTax).toBe(5000);
  });
});

describe('reconcile with an unparsed field', () => {
  it('waits for the next keystroke instead of forcing a zero', () => {
    const form = baseForm();
    const result = pass(form, { ...form, goldPrice: Number.NaN });

    expect(result.goldWeightGrams).toBe(10);
    expect(Number.isNaN(result.goldPrice)).toBe(true);
  });

  it('treats an unparsed weight as zero for the price only', () => {
    const form = baseForm();
    const result = pass(form, { ...form, goldWeightGrams: Number.NaN });

    expect(result.goldPrice).toBe(0);
    expect(Number.isNaN(result.goldWeightGrams)).toBe(true);
  });
});

describe('reconcile after a rate change', () => {
  it('reprices from the weight, not from the old gold price', () => {
    const form = baseForm();
    const result = reconcile(form, form, 7800, GST);

    expect(result.goldPrice).toBe(71500);
    expect(result.goldWeightGrams).toBe(10);
  });
});

describe('any karat', () => {
  it('prices a karat that the rate board does not list', () => {
    const odd = articleToForm({ ...ARTICLE, karat: 21, stones: [] }, PRICE_24, GST);

    expect(odd.goldPrice).toBe(63000);
    expect(odd.makingCharge).toBe(7560);
  });

  it('prices a low karat', () => {
    const nine = articleToForm({ ...ARTICLE, karat: 9, stones: [] }, PRICE_24, GST);

    expect(nine.goldPrice).toBe(27000);
  });

  it('reprices when the karat changes', () => {
    const form = baseForm();
    const result = pass(form, { ...form, karat: 20 });

    expect(result.goldPrice).toBe(60000);
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

    expect(sameSource(form, { ...form, goldWeightGrams: 11 })).toBe(false);
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
      karat: 22,
      goldWeightGrams: 10,
      makingChargePercent: 12,
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
    const patch = formToArticlePatch({ ...baseForm(), goldWeightGrams: Number.NaN });

    expect(patch.goldWeightGrams).toBe(0);
  });
});
