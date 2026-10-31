import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { GoldStore } from '../core/gold-store';
import { computeArticle } from '../core/gold-math';
import { ImageStore } from '../core/image-store';
import { Article, METAL_NAMES } from '../core/models';
import { GramsPipe, InrPipe } from '../core/inr-pipe';
import { PhotoCarousel } from '../photo-carousel/photo-carousel';
import { PhotoViewer } from '../photo-viewer/photo-viewer';
import { formatDay } from '../core/dates';

/**
 * The view mode of one article. It is built for a quick look at the counter: the photos,
 * the price to pay, and the few facts that set that price. It has no input fields except
 * the checkbox that counts the piece in the totals.
 */
@Component({
  selector: 'app-article-view',
  imports: [InrPipe, GramsPipe, PhotoCarousel, PhotoViewer],
  template: `
    <article class="card p-3" [attr.aria-labelledby]="'view-title-' + article().id">
      <div class="flex items-start gap-2">
        <input
          class="mt-1 h-6 w-6 shrink-0 accent-amber-700 dark:accent-amber-500"
          type="checkbox"
          [id]="'view-pick-' + article().id"
          [checked]="article().selected"
          (change)="toggle($event)"
        />
        <label class="sr-only" [attr.for]="'view-pick-' + article().id">
          Count {{ name() }} in the totals
        </label>

        <div class="min-w-0 flex-1">
          <h2 class="truncate font-semibold" [id]="'view-title-' + article().id">
            {{ article().name.trim() || 'Unnamed piece' }}
          </h2>
          <p class="muted text-xs">
            {{ purity() }} · {{ article().weightGrams | grams }}
            @if (dates()) {
              · {{ dates() }}
            }
          </p>
        </div>

        <button
          #editButton
          type="button"
          class="btn-quiet shrink-0"
          [attr.aria-label]="'Edit ' + name()"
          (click)="edit.emit()"
        >
          Edit
        </button>
      </div>

      @if (photos().length > 0) {
        <app-photo-carousel
          class="mt-3"
          [photos]="photos()"
          [label]="name()"
          [openable]="true"
          [(index)]="shown"
          (opened)="viewing.set($event)"
        />
        <app-photo-viewer
          [photos]="photos()"
          [start]="viewing()"
          [articleName]="article().name"
          (closed)="viewing.set(null)"
        />
      }

      <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm tabular-nums">
        <dt class="muted">{{ metalName() }} value</dt>
        <dd class="text-right">{{ price().metalPrice | inr }}</dd>

        <dt class="muted">Making charge, {{ article().makingChargePercent }}%</dt>
        <dd class="text-right">{{ price().makingCharge | inr }}</dd>

        @if (article().stones.length > 0) {
          <dt class="muted">
            {{ article().stones.length }} {{ article().stones.length === 1 ? 'stone' : 'stones' }}
          </dt>
          <dd class="text-right">{{ price().stonePrice | inr }}</dd>
        }

        <dt class="muted">Tax</dt>
        <dd class="text-right">{{ price().tax | inr }}</dd>

        <dt class="font-medium">Price after tax</dt>
        <dd class="text-right text-lg font-semibold text-amber-800 dark:text-amber-300">
          {{ price().priceAfterTax | inr }}
        </dd>
      </dl>

      @if (article().notes.trim()) {
        <p class="muted mt-2 text-sm whitespace-pre-line">{{ article().notes }}</p>
      }
    </article>
  `,
})
export class ArticleView {
  readonly article = input.required<Article>();
  /** True when the user just left edit mode. The focus returns to the Edit button. */
  readonly focusOnInit = input(false);
  readonly edit = output<void>();

  private readonly store = inject(GoldStore);
  private readonly images = inject(ImageStore);
  private readonly editButton = viewChild.required<ElementRef<HTMLButtonElement>>('editButton');

  private readonly list = computed(() => this.images.imagesFor(this.article().id));
  protected readonly photos = computed(() => this.list()());

  protected readonly price = computed(() => computeArticle(this.article(), this.store.pricing()));
  /** The photo the small carousel shows. */
  protected readonly shown = signal(0);
  /** The photo the large carousel opened on, or null when it is closed. */
  protected readonly viewing = signal<number | null>(null);

  /** The booking and purchase dates of a gold piece, for the line under the name. */
  protected readonly dates = computed(() => {
    const article = this.article();
    if (article.metal !== 'gold') {
      return '';
    }
    const parts: string[] = [];
    if (article.bookingDate) {
      parts.push(`booked ${formatDay(article.bookingDate)}`);
    }
    if (article.purchaseDate) {
      parts.push(`bought ${formatDay(article.purchaseDate)}`);
    }
    return parts.join(' · ');
  });

  protected readonly name = computed(() => this.article().name.trim() || 'this article');
  protected readonly metalName = computed(() => METAL_NAMES[this.article().metal]);
  protected readonly purity = computed(() => {
    const article = this.article();
    return article.metal === 'gold' ? `Gold ${article.karat}kt` : METAL_NAMES[article.metal];
  });

  constructor() {
    afterNextRender(() => {
      if (this.focusOnInit()) {
        this.editButton().nativeElement.focus();
      }
    });
  }

  protected toggle(event: Event): void {
    const selected = (event.target as HTMLInputElement).checked;
    this.store.patchArticle(this.article().id, { selected });
  }
}
