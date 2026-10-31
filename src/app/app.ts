import { Component, computed, inject, signal } from '@angular/core';
import { GoldStore } from './core/gold-store';
import { RateBar } from './rate-bar/rate-bar';
import { CollectionSheet } from './collection-sheet/collection-sheet';
import { ArticleCard } from './article-card/article-card';
import { ArticleView } from './article-view/article-view';
import { SummaryBar } from './summary-bar/summary-bar';
import { ShopDialog, ShopDialogMode } from './shop-dialog/shop-dialog';

@Component({
  selector: 'app-root',
  imports: [RateBar, CollectionSheet, ArticleCard, ArticleView, SummaryBar, ShopDialog],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(GoldStore);
  protected readonly sheetOpen = signal(false);

  /** The shop dialog the user asked for, or null. */
  private readonly shopRequest = signal<ShopDialogMode | null>(null);

  /** With no shop at all, the app cannot work, so it asks for one. */
  protected readonly needsShop = computed(
    () => this.store.ready() && this.store.collections().length === 0,
  );
  protected readonly shopDialogMode = computed<ShopDialogMode | null>(() =>
    this.needsShop() ? 'add' : this.shopRequest(),
  );

  /** The one article in edit mode. Every other article shows its view mode. */
  protected readonly editingId = signal<string | null>(null);
  /** The article that just left edit mode. Its view takes the focus back. */
  protected readonly lastEditedId = signal<string | null>(null);

  protected openShopDialog(mode: ShopDialogMode): void {
    this.shopRequest.set(mode);
  }

  protected closeShopDialog(): void {
    this.shopRequest.set(null);
  }

  protected add(): void {
    const article = this.store.addArticle();

    if (article) {
      this.editingId.set(article.id);
    }
  }

  protected edit(id: string): void {
    this.lastEditedId.set(null);
    this.editingId.set(id);
  }

  protected done(id: string): void {
    this.lastEditedId.set(id);
    this.editingId.set(null);
  }

  protected remove(id: string): void {
    this.editingId.set(null);
    void this.store.removeArticle(id);
  }
}
