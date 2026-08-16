import { Article, Stone } from './models';
import {
  computeArticle,
  percentFromMakingCharge,
  percentFromPriceAfterTax,
  percentFromPriceBeforeTax,
  ratePerGram,
  stoneTotals,
  weightFromGoldPrice,
} from './gold-math';

/**
 * The model behind one article card.
 *
 * Signal forms treat the model signal as the single source of truth. A field write goes
 * straight into that signal. The model therefore holds the source fields and the derived
 * fields together, and `reconcile` keeps the two groups consistent.
 */
export interface ArticleForm {
  // Source fields. The user owns these.
  name: string;
  notes: string;
  /** Any karat from 1 to 24. */
  karat: number;
  goldWeightGrams: number;
  makingChargePercent: number;
  /** Zero or more stones. Their totals feed the price. */
  stones: Stone[];
  selected: boolean;

  // Derived fields. `reconcile` owns these, except the one the user just typed in.
  goldPrice: number;
  makingCharge: number;
  priceBeforeTax: number;
  priceAfterTax: number;
}

/** The four fields that a reverse solver can write back into a source field. */
export const DERIVED_KEYS = [
  'goldPrice',
  'makingCharge',
  'priceBeforeTax',
  'priceAfterTax',
] as const;

export type DerivedKey = (typeof DERIVED_KEYS)[number];

/** Money keeps 2 decimal places. A rupee has 100 paise. */
const MONEY_DP = 2;
/**
 * A weight and a percentage keep 4 decimal places. Fewer places would round the solved
 * value hard enough to move the price the user typed by a visible amount.
 */
const RATIO_DP = 4;

/** The price inputs of one form model, with the stone list already added up. */
export function formToPriceInput(form: ArticleForm) {
  const stones = stoneTotals(form.stones);

  return {
    karat: form.karat,
    goldWeightGrams: num(form.goldWeightGrams),
    makingChargePercent: num(form.makingChargePercent),
    stoneWeightGrams: stones.weightGrams,
    stonePrice: stones.price,
  };
}

export function articleToForm(
  article: Article,
  pricePerGram24: number,
  gstPercent: number,
): ArticleForm {
  const source: ArticleForm = {
    name: article.name,
    notes: article.notes,
    karat: article.karat,
    goldWeightGrams: article.goldWeightGrams,
    makingChargePercent: article.makingChargePercent,
    stones: article.stones,
    selected: article.selected,
    goldPrice: 0,
    makingCharge: 0,
    priceBeforeTax: 0,
    priceAfterTax: 0,
  };

  return withDerived(source, pricePerGram24, gstPercent);
}

/** The source fields of the form, ready for a store patch. */
export function formToArticlePatch(form: ArticleForm): Partial<Article> {
  return {
    name: form.name,
    notes: form.notes,
    karat: form.karat,
    goldWeightGrams: num(form.goldWeightGrams),
    makingChargePercent: num(form.makingChargePercent),
    stones: form.stones.map((stone) => ({
      ...stone,
      weightGrams: num(stone.weightGrams),
      price: num(stone.price),
    })),
    selected: form.selected,
  };
}

/**
 * Bring one form model back to a consistent state after a change.
 *
 * The steps run in this order:
 *
 * 1. Compare `next` against `previous` to find the changed keys.
 * 2. A changed derived key wins. Its solver writes the matching source field.
 * 3. Otherwise a source field changed, or the rate changed. Every derived field
 *    recomputes.
 * 4. Recompute every derived field except the one the user typed in.
 *
 * Step 4 is the loop guard and the cursor guard. The app never rewrites the field under
 * the user's cursor, so `reconcile` reaches a fixed point after one pass.
 */
export function reconcile(
  previous: ArticleForm,
  next: ArticleForm,
  pricePerGram24: number,
  gstPercent: number,
): ArticleForm {
  const editedKey = changedDerivedKey(previous, next);
  const source = editedKey ? solve(next, editedKey, pricePerGram24, gstPercent) : next;
  const result = withDerived(source, pricePerGram24, gstPercent);

  // Keep the typed number exactly as the user typed it.
  if (editedKey) {
    result[editedKey] = next[editedKey];
  }

  return result;
}

/** Fill the four derived fields from the source fields. */
function withDerived(
  source: ArticleForm,
  pricePerGram24: number,
  gstPercent: number,
): ArticleForm {
  const price = computeArticle(formToPriceInput(source), pricePerGram24, gstPercent);

  return {
    ...source,
    goldPrice: round(price.goldPrice, MONEY_DP),
    makingCharge: round(price.makingCharge, MONEY_DP),
    priceBeforeTax: round(price.priceBeforeTax, MONEY_DP),
    priceAfterTax: round(price.priceAfterTax, MONEY_DP),
  };
}

/** A form model for a card that has no article yet. `ngOnInit` replaces it. */
export const BLANK_FORM: ArticleForm = {
  name: '',
  notes: '',
  karat: 22,
  goldWeightGrams: 0,
  makingChargePercent: 0,
  stones: [],
  selected: true,
  goldPrice: 0,
  makingCharge: 0,
  priceBeforeTax: 0,
  priceAfterTax: 0,
};

export function newStone(): Stone {
  return { id: crypto.randomUUID(), kind: '', weightGrams: 0, price: 0 };
}

/** True when the two models hold the same value in every field. */
export function sameForm(a: ArticleForm, b: ArticleForm): boolean {
  return (Object.keys(a) as (keyof ArticleForm)[]).every((key) => Object.is(a[key], b[key]));
}

/** The first derived field whose value the user changed, or null. */
export function changedDerivedKey(previous: ArticleForm, next: ArticleForm): DerivedKey | null {
  return DERIVED_KEYS.find((key) => !Object.is(previous[key], next[key])) ?? null;
}

/**
 * True when no source field changed.
 *
 * The card holds the number the user typed into a derived field until this returns
 * false. Without that hold, the settle pass would replace the typed price with the price
 * that the rounded percentage produces, which moves the last few paise.
 */
export function sameSource(a: ArticleForm, b: ArticleForm): boolean {
  const derived = new Set<string>(DERIVED_KEYS);
  const keys = (Object.keys(a) as (keyof ArticleForm)[]).filter((key) => !derived.has(key));

  return keys.every((key) => {
    if (key === 'stones') {
      return sameStones(a.stones, b.stones);
    }
    return Object.is(a[key], b[key]);
  });
}

function sameStones(a: readonly Stone[], b: readonly Stone[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (stone, index) =>
        stone.id === b[index].id &&
        stone.kind === b[index].kind &&
        Object.is(stone.weightGrams, b[index].weightGrams) &&
        Object.is(stone.price, b[index].price),
    )
  );
}

/**
 * Run the solver for the edited field and write the result into its source field.
 *
 * A solver returns null when the gold price is zero, because the division has no answer.
 * The form then keeps the source field it already had. The schema disables those fields
 * in that state, so a user cannot reach this path through the UI.
 */
function solve(
  form: ArticleForm,
  key: DerivedKey,
  pricePerGram24: number,
  gstPercent: number,
): ArticleForm {
  const typed = form[key];

  // An unparsed field holds no number yet. Wait for the next keystroke.
  if (!Number.isFinite(typed)) {
    return form;
  }

  const rate = ratePerGram(pricePerGram24, form.karat);
  const goldPrice = num(form.goldWeightGrams) * rate;
  const stonePrice = stoneTotals(form.stones).price;

  if (key === 'goldPrice') {
    const weight = weightFromGoldPrice(typed, rate);
    return weight === null ? form : { ...form, goldWeightGrams: round(weight, RATIO_DP) };
  }

  const percent =
    key === 'makingCharge'
      ? percentFromMakingCharge(typed, goldPrice)
      : key === 'priceBeforeTax'
        ? percentFromPriceBeforeTax(typed, goldPrice, stonePrice)
        : percentFromPriceAfterTax(typed, goldPrice, stonePrice, gstPercent);

  return percent === null ? form : { ...form, makingChargePercent: round(percent, RATIO_DP) };
}

/** Treat an empty or unparsed field as zero for the calculation only. */
function num(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function round(value: number, decimalPlaces: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}
