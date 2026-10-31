import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { disabled, form, FormField, max, min } from '@angular/forms/signals';
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
import { computeArticle, Pricing, rate24, ratePerGram, stoneTotals } from '../core/gold-math';
import { formatDay } from '../core/dates';
import {
  Article,
  GRAMS_PER_CARAT,
  KARATS,
  MAX_KARAT,
  Metal,
  METAL_NAMES,
  METALS,
  StoneUnit,
  STONE_UNITS,
  UNIT_NAMES,
} from '../core/models';
import { GramsPipe, InrPipe } from '../core/inr-pipe';
import { ArticlePhotos } from '../article-photos/article-photos';

const NEEDS_METAL_PRICE = 'Enter a weight and a rate first.';

/**
 * The edit mode of one article. It shows every field, and every derived price field
 * stays editable.
 */
@Component({
  selector: 'app-article-card',
  imports: [FormField, InrPipe, GramsPipe, ArticlePhotos],
  templateUrl: './article-card.html',
})
export class ArticleCard implements OnInit {
  readonly article = input.required<Article>();
  readonly removed = output<void>();
  /** The user is done. The shell shows the view mode again. */
  readonly done = output<void>();

  protected readonly store = inject(GoldStore);
  protected readonly karats = KARATS;
  protected readonly metals = METALS;
  protected readonly metalNames = METAL_NAMES;
  protected readonly units = STONE_UNITS;
  protected readonly unitNames = UNIT_NAMES;
  protected readonly needsMetalPrice = NEEDS_METAL_PRICE;

  /**
   * The card owns one model, and `ngOnInit` seeds it once.
   *
   * The model must never re-derive from the `article` input. A patch sent to the store
   * comes straight back as a new input object, and a re-derivation at that moment would
   * overwrite the number the user is still typing.
   */
  protected readonly model = signal<ArticleForm>(BLANK_FORM);

  /** The read-only lines under the price fields. */
  protected readonly price = computed(() =>
    computeArticle(formToPriceInput(this.model()), this.store.pricing()),
  );

  /** The three reverse fields divide by the net making base. They need a base above zero. */
  protected readonly canSolve = computed(() => this.price().netMakingBase > 0);

  /**
   * The rules of the form. The three reverse fields divide by the making base, so the
   * schema disables them while the base is zero and states why.
   */
  protected readonly f = form(this.model, (article) => {
    min(article.weightGrams, 0);
    min(article.makingDiscountPercent, 0, { message: 'A discount runs from 0 to 100%.' });
    max(article.makingDiscountPercent, 100, { message: 'A discount runs from 0 to 100%.' });
    min(article.karat, 1, { message: 'A karat runs from 1 to 24.' });
    max(article.karat, MAX_KARAT, { message: 'A karat runs from 1 to 24.' });

    const noBase = () => (this.canSolve() ? false : NEEDS_METAL_PRICE);
    disabled(article.makingCharge, { when: noBase });
    disabled(article.priceBeforeTax, { when: noBase });
    disabled(article.priceAfterTax, { when: noBase });
  });

  protected readonly id = computed(() => this.article().id);
  protected readonly name = computed(() => this.model().name.trim() || 'this article');
  protected readonly heading = computed(() => this.model().name.trim() || 'Unnamed piece');
  protected readonly isGold = computed(() => this.model().metal === 'gold');
  protected readonly metalName = computed(() => METAL_NAMES[this.model().metal]);
  /**
   * One choice per day with a gold rate, newest first. Each label shows the rate at the
   * karat of this piece. Of two rates on one day, the later entry wins, as in the math.
   */
  protected readonly rateDays = computed(() => {
    const karat = this.model().karat;
    const byDay = new Map<string, number>();

    for (const rate of this.store.pricing().goldRates) {
      byDay.set(rate.date, ratePerGram(rate24(rate), karat));
    }

    return [...byDay.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, perGram]) => ({ date, label: formatDay(date), perGram }));
  });

  /** True when the metal value and the making charge use two different gold rates. */
  protected readonly twoRates = computed(
    () => this.price().valueRate.date !== this.price().purchaseRate.date,
  );

  protected readonly formatDay = formatDay;

  /** Carats for the label. The division leaves a floating point tail, so it rounds. */
  protected readonly stoneCarats = computed(
    () =>
      Math.round((stoneTotals(this.model().stones).weightGrams / GRAMS_PER_CARAT) * 1000) / 1000,
  );

  protected readonly isDiscount = computed(() => numberOf(this.model().makingChargePercent) < 0);

  private readonly nameField = viewChild.required<ElementRef<HTMLInputElement>>('nameField');

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
  private lastPricing: Pricing | undefined;

  constructor() {
    effect(() => {
      const next = this.model();
      const pricing = this.store.pricing();

      this.previous ??= next;
      const edited = changedDerivedKey(this.previous, next);
      const repriced = pricing !== this.lastPricing;
      this.lastPricing = pricing;

      if (edited) {
        this.sticky = { key: edited, value: next[edited] };
      } else if (repriced || !sameSource(this.previous, next)) {
        this.sticky = undefined;
      }

      const result = reconcile(this.previous, next, pricing);

      if (this.sticky && Number.isFinite(this.sticky.value)) {
        result[this.sticky.key] = this.sticky.value;
      }

      this.previous = result;

      if (!sameForm(result, next)) {
        this.model.set(result);
      }

      untracked(() => this.store.patchArticle(this.article().id, formToArticlePatch(result)));
    });

    // Edit mode opens on a tap of the Edit button. Move the focus into the form.
    afterNextRender(() => this.nameField().nativeElement.focus());
  }

  ngOnInit(): void {
    this.model.set(articleToForm(this.article(), this.store.pricing()));
  }

  protected setMetal(metal: Metal): void {
    this.model.update((current) => ({ ...current, metal }));
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

  protected setStoneUnit(index: number, unit: StoneUnit): void {
    this.model.update((current) => ({
      ...current,
      stones: current.stones.map((stone, at) => (at === index ? { ...stone, unit } : stone)),
    }));
  }

  protected rateLabel(rateId: string): string {
    const rates = this.store.pricing().stoneRates;
    const index = rates.findIndex((rate) => rate.id === rateId);
    return index < 0 ? '' : rates[index].kind.trim() || `Stone rate ${index + 1}`;
  }
}

function numberOf(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
