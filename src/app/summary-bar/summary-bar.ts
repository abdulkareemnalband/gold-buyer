import { Component, inject, signal } from '@angular/core';
import { GoldStore } from '../core/gold-store';
import { GramsPipe, InrPipe } from '../core/inr-pipe';
import { InvoiceDialog } from '../invoice-dialog/invoice-dialog';

/** The totals of the selected articles in the active shop, and the invoice button. */
@Component({
  selector: 'app-summary-bar',
  imports: [InrPipe, GramsPipe, InvoiceDialog],
  template: `
    <div
      class="border-t border-stone-200 bg-white px-3 py-2 dark:border-stone-800 dark:bg-stone-900"
    >
      <div class="mx-auto flex max-w-xl items-end gap-3">
        <!-- The live region holds the figures only, so a screen reader reads a change in
             the totals and not the button. -->
        <div class="flex flex-1 items-end justify-between gap-3" role="status" aria-live="polite">
          <div>
            <p class="muted text-xs">
              {{ store.totals().count }} of {{ store.activeArticles().length }} picked ·
              {{ store.totals().totalWeightGrams | grams }}
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

        <button
          type="button"
          class="btn-quiet shrink-0"
          aria-haspopup="dialog"
          [disabled]="store.totals().count === 0"
          (click)="invoiceOpen.set(true)"
        >
          Invoice
        </button>
      </div>
    </div>

    <app-invoice-dialog [open]="invoiceOpen()" (closed)="invoiceOpen.set(false)" />
  `,
})
export class SummaryBar {
  protected readonly store = inject(GoldStore);
  protected readonly invoiceOpen = signal(false);
}
