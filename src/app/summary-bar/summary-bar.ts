import { Component, inject } from '@angular/core';
import { GoldStore } from '../core/gold-store';
import { GramsPipe, InrPipe } from '../core/inr-pipe';

/** The totals of the selected articles in the active shop. */
@Component({
  selector: 'app-summary-bar',
  imports: [InrPipe, GramsPipe],
  template: `
    <div
      class="border-t border-stone-200 bg-white px-3 py-2 dark:border-stone-800 dark:bg-stone-900"
      role="status"
      aria-live="polite"
    >
      <div class="mx-auto flex max-w-xl items-end justify-between gap-3">
        <div>
          <p class="muted text-xs">
            {{ store.totals().count }} of {{ store.activeArticles().length }} picked
            · {{ store.totals().totalWeightGrams | grams }}
          </p>
          <p class="muted text-xs tabular-nums">
            Before tax {{ store.totals().priceBeforeTax | inr }} · tax
            {{ store.totals().tax | inr }}
          </p>
        </div>

        <div class="text-right">
          <p class="muted text-xs">Total to pay</p>
          <p class="text-xl font-semibold tabular-nums text-amber-800 dark:text-amber-300">
            {{ store.totals().priceAfterTax | inr }}
          </p>
        </div>
      </div>
    </div>
  `,
})
export class SummaryBar {
  protected readonly store = inject(GoldStore);
}
