import { Component, inject, signal } from '@angular/core';
import { GoldStore } from './core/gold-store';
import { RateBar } from './rate-bar/rate-bar';
import { CollectionSheet } from './collection-sheet/collection-sheet';
import { ArticleCard } from './article-card/article-card';
import { SummaryBar } from './summary-bar/summary-bar';

@Component({
  selector: 'app-root',
  imports: [RateBar, CollectionSheet, ArticleCard, SummaryBar],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(GoldStore);
  protected readonly sheetOpen = signal(false);

  protected add(): void {
    this.store.addArticle();
  }

  protected remove(id: string): void {
    void this.store.removeArticle(id);
  }
}
