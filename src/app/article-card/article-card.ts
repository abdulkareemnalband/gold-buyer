import { Component, computed, effect, inject, input, OnInit, output, signal, untracked } from '@angular/core';
import { disabled, form, FormField, max, min, schema } from '@angular/forms/signals';
import {
  ArticleForm,
  articleToForm,
  BLANK_FORM,
  changedDerivedKey,
  DerivedKey,
  formToArticlePatch,
  formToPriceInput,
  newStone,
  reconcile,
  sameForm,
  sameSource,
} from '../core/article-form';
import { GoldStore } from '../core/gold-store';
import { computeArticle, stoneTotals } from '../core/gold-math';
import { Article, GRAMS_PER_CARAT, KARATS, MAX_KARAT } from '../core/models';
import { GramsPipe, InrPipe } from '../core/inr-pipe';
import { ArticlePhotos } from '../article-photos/article-photos';

const NEEDS_GOLD_PRICE = 'Enter a weight and a rate first.';

/**
 * The rules that hold for every article card.
 *
 * The three reverse fields divide by the gold price. A zero gold price makes them
 * undefined, so the schema disables them and states why.
 */
const articleSchema = schema<ArticleForm>((article) => {
  min(article.goldWeightGrams, 0);
  min(article.karat, 1, { message: 'A karat runs from 1 to 24.' });
  max(article.karat, MAX_KARAT, { message: 'A karat runs from 1 to 24.' });

  const noGoldPrice = ({ valueOf }: { valueOf: (path: typeof article.goldPrice) => number }) =>
    valueOf(article.goldPrice) > 0 ? false : NEEDS_GOLD_PRICE;

  disabled(article.makingCharge, { when: noGoldPrice });
  disabled(article.priceBeforeTax, { when: noGoldPrice });
  disabled(article.priceAfterTax, { when: noGoldPrice });
});

@Component({
  selector: 'app-article-card',
  imports: [FormField, InrPipe, GramsPipe, ArticlePhotos],
  templateUrl: './article-card.html',
})
export class ArticleCard implements OnInit {
  readonly article = input.required<Article>();
  readonly removed = output<void>();

  protected readonly store = inject(GoldStore);
  protected readonly karats = KARATS;
  protected readonly needsGoldPrice = NEEDS_GOLD_PRICE;

  /**
   * The card owns one model, and `ngOnInit` seeds it once.
   *
   * The model must never re-derive from the `article` input. A patch sent to the store
   * comes straight back as a new input object, and a re-derivation at that moment would
   * overwrite the number the user is still typing.
   */
  protected readonly model = signal<ArticleForm>(BLANK_FORM);

  protected readonly f = form(this.model, articleSchema);

  protected readonly id = computed(() => this.article().id);
  protected readonly name = computed(() => this.model().name.trim() || 'this article');

  /** The read-only lines under the price fields. */
  protected readonly price = computed(() =>
    computeArticle(
      formToPriceInput(this.model()),
      this.store.pricePerGram24(),
      this.store.gstPercent(),
    ),
  );

  /** Carats for the label. The division leaves a floating point tail, so it rounds. */
  protected readonly stoneCarats = computed(
    () => Math.round((stoneTotals(this.model().stones).weightGrams / GRAMS_PER_CARAT) * 1000) / 1000,
  );

  protected readonly isDiscount = computed(() => numberOf(this.model().makingChargePercent) < 0);
  protected readonly canSolve = computed(() => this.price().goldPrice > 0);

  /** The last reconciled model. The effect seeds it on its first run. */
  private previous: ArticleForm | undefined;

  /**
   * The number the user last typed into a derived field.
   *
   * The card holds it until a source field or the rate changes. Without that hold, the
   * settle pass would show the price that the rounded percentage produces, which sits a
   * few paise away from the price the user typed.
   */
  private sticky: { key: DerivedKey; value: number } | undefined;
  private lastRate = Number.NaN;
  private lastGst = Number.NaN;

  constructor() {
    effect(() => {
      const next = this.model();
      const pricePerGram24 = this.store.pricePerGram24();
      const gstPercent = this.store.gstPercent();

      this.previous ??= next;
      const edited = changedDerivedKey(this.previous, next);
      const repriced = pricePerGram24 !== this.lastRate || gstPercent !== this.lastGst;
      this.lastRate = pricePerGram24;
      this.lastGst = gstPercent;

      if (edited) {
        this.sticky = { key: edited, value: next[edited] };
      } else if (repriced || !sameSource(this.previous, next)) {
        this.sticky = undefined;
      }

      const result = reconcile(this.previous, next, pricePerGram24, gstPercent);

      if (this.sticky && Number.isFinite(this.sticky.value)) {
        result[this.sticky.key] = this.sticky.value;
      }

      this.previous = result;

      if (!sameForm(result, next)) {
        this.model.set(result);
      }

      untracked(() => this.store.patchArticle(this.article().id, formToArticlePatch(result)));
    });
  }

  ngOnInit(): void {
    this.model.set(
      articleToForm(this.article(), this.store.pricePerGram24(), this.store.gstPercent()),
    );
  }

  protected setKarat(karat: number): void {
    this.model.update((current) => ({ ...current, karat }));
  }

  protected addStone(): void {
    this.model.update((current) => ({ ...current, stones: [...current.stones, newStone()] }));
  }

  protected removeStone(stoneId: string): void {
    this.model.update((current) => ({
      ...current,
      stones: current.stones.filter((stone) => stone.id !== stoneId),
    }));
  }
}

function numberOf(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
