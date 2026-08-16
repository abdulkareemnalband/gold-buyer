import { computed, DestroyRef, inject, Service, signal } from '@angular/core';
import * as db from './gold-db';
import { computeTotals, ratePerGram, stoneTotals } from './gold-math';
import { ImageStore } from './image-store';
import {
  Article,
  Collection,
  DEFAULT_GST_PERCENT,
  Karat,
  Settings,
  SETTINGS_KEY,
} from './models';

/** A write waits this long for the next keystroke before it reaches IndexedDB. */
const WRITE_DELAY_MS = 400;

/**
 * The application state.
 *
 * Every signal here mirrors one IndexedDB store. A change updates the signal at once,
 * then reaches the database after a short delay. The app also flushes on `pagehide`, so
 * a closed tab loses nothing.
 */
@Service()
export class GoldStore {
  private readonly images = inject(ImageStore);

  private readonly settingsState = signal<Settings>({
    id: SETTINGS_KEY,
    activeCollectionId: '',
    gstPercent: DEFAULT_GST_PERCENT,
  });
  private readonly collectionsState = signal<Collection[]>([]);
  private readonly articlesState = signal<Article[]>([]);
  private readonly readyState = signal(false);

  /** False until the first read from IndexedDB lands. The shell shows a wait note. */
  readonly ready = this.readyState.asReadonly();
  readonly settings = this.settingsState.asReadonly();
  readonly collections = this.collectionsState.asReadonly();

  readonly activeCollection = computed<Collection | undefined>(() => {
    const collections = this.collectionsState();
    const activeId = this.settingsState().activeCollectionId;
    return collections.find((one) => one.id === activeId) ?? collections[0];
  });

  readonly activeArticles = computed<Article[]>(() => {
    const collectionId = this.activeCollection()?.id;

    if (!collectionId) {
      return [];
    }

    return this.articlesState()
      .filter((article) => article.collectionId === collectionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  });

  readonly pricePerGram24 = computed(() => this.activeCollection()?.pricePerGram24 ?? 0);
  readonly displayKarat = computed<Karat>(() => this.activeCollection()?.displayKarat ?? 22);
  readonly displayRate = computed(() => ratePerGram(this.pricePerGram24(), this.displayKarat()));
  readonly gstPercent = computed(() => this.settingsState().gstPercent);

  /** The totals cover the selected articles of the active collection only. */
  readonly totals = computed(() =>
    computeTotals(
      this.activeArticles()
        .filter((article) => article.selected)
        .map((article) => {
          const stones = stoneTotals(article.stones);
          return {
            karat: article.karat,
            goldWeightGrams: article.goldWeightGrams,
            makingChargePercent: article.makingChargePercent,
            stoneWeightGrams: stones.weightGrams,
            stonePrice: stones.price,
          };
        }),
      this.pricePerGram24(),
      this.gstPercent(),
    ),
  );

  private readonly pending = new Map<string, () => Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly flushNow = () => void this.flush();

  constructor() {
    void this.load();

    addEventListener('pagehide', this.flushNow);
    inject(DestroyRef).onDestroy(() => {
      removeEventListener('pagehide', this.flushNow);
      void this.flush();
    });
  }

  // --- Collections ---------------------------------------------------------------

  /** A new collection starts from the rate of the active one, because a trip is one day. */
  addCollection(title: string): Collection {
    const active = this.activeCollection();
    const collection: Collection = {
      id: crypto.randomUUID(),
      title: title.trim() || this.nextCollectionTitle(),
      pricePerGram24: active?.pricePerGram24 ?? 0,
      displayKarat: active?.displayKarat ?? 22,
      createdAt: Date.now(),
    };

    this.collectionsState.update((all) => [...all, collection]);
    this.schedule(`collection:${collection.id}`, () => db.putCollection(collection));
    this.setActiveCollection(collection.id);

    return collection;
  }

  renameCollection(id: string, title: string): void {
    this.patchCollection(id, { title: title.trim() || this.nextCollectionTitle() });
  }

  setActiveCollection(id: string): void {
    this.patchSettings({ activeCollectionId: id });
  }

  setPrice24(pricePerGram24: number): void {
    const id = this.activeCollection()?.id;

    if (id) {
      this.patchCollection(id, { pricePerGram24: Math.max(0, safe(pricePerGram24)) });
    }
  }

  setDisplayKarat(displayKarat: Karat): void {
    const id = this.activeCollection()?.id;

    if (id) {
      this.patchCollection(id, { displayKarat });
    }
  }

  /** Delete a collection, its articles, and their photos. */
  async removeCollection(id: string): Promise<void> {
    const articleIds = this.articlesState()
      .filter((article) => article.collectionId === id)
      .map((article) => article.id);

    this.collectionsState.update((all) => all.filter((one) => one.id !== id));
    this.articlesState.update((all) => all.filter((article) => article.collectionId !== id));

    await this.flush();
    const imageIds = await db.deleteCollectionDeep(id);
    this.images.forget(imageIds, articleIds);

    const remaining = this.collectionsState();
    if (remaining.length === 0) {
      this.addCollection(this.nextCollectionTitle());
    } else if (this.settingsState().activeCollectionId === id) {
      this.setActiveCollection(remaining[0].id);
    }
  }

  /** How many articles a delete would take with it. */
  articleCount(collectionId: string): number {
    return this.articlesState().filter((article) => article.collectionId === collectionId).length;
  }

  // --- Articles ------------------------------------------------------------------

  addArticle(): Article | undefined {
    const collection = this.activeCollection();

    if (!collection) {
      return undefined;
    }

    const article: Article = {
      id: crypto.randomUUID(),
      collectionId: collection.id,
      name: '',
      notes: '',
      karat: collection.displayKarat,
      goldWeightGrams: 0,
      makingChargePercent: 0,
      stones: [],
      selected: true,
      createdAt: Date.now(),
    };

    this.articlesState.update((all) => [...all, article]);
    this.schedule(`article:${article.id}`, () => db.putArticle(article));

    return article;
  }

  /**
   * A patch that changes nothing must touch no signal. The article cards send one patch
   * per pass, and a new array each time would send every card a new input object, which
   * turns into an endless refresh.
   */
  patchArticle(id: string, patch: Partial<Article>): void {
    const current = this.articlesState().find((article) => article.id === id);

    if (!current || same(current, patch)) {
      return;
    }

    let updated: Article | undefined;

    this.articlesState.update((all) =>
      all.map((article) => {
        if (article.id !== id) {
          return article;
        }
        updated = { ...article, ...patch, id: article.id, collectionId: article.collectionId };
        return updated;
      }),
    );

    if (updated) {
      const row = updated;
      this.schedule(`article:${id}`, () => db.putArticle(row));
    }
  }

  async removeArticle(id: string): Promise<void> {
    this.articlesState.update((all) => all.filter((article) => article.id !== id));

    await this.flush();
    const imageIds = await db.deleteArticleDeep(id);
    this.images.forget(imageIds, [id]);
  }

  // --- Loading and writing -------------------------------------------------------

  private async load(): Promise<void> {
    const snapshot = await db.loadSnapshot();

    this.collectionsState.set(snapshot.collections.sort((a, b) => a.createdAt - b.createdAt));
    this.articlesState.set(snapshot.articles);

    if (snapshot.settings) {
      this.settingsState.set(snapshot.settings);
    }

    if (this.collectionsState().length === 0) {
      this.addCollection('Shop 1');
    } else if (!this.activeCollection()) {
      this.setActiveCollection(this.collectionsState()[0].id);
    }

    this.readyState.set(true);
  }

  private patchCollection(id: string, patch: Partial<Collection>): void {
    let updated: Collection | undefined;

    this.collectionsState.update((all) =>
      all.map((collection) => {
        if (collection.id !== id) {
          return collection;
        }
        updated = { ...collection, ...patch, id: collection.id };
        return updated;
      }),
    );

    if (updated) {
      const row = updated;
      this.schedule(`collection:${id}`, () => db.putCollection(row));
    }
  }

  private patchSettings(patch: Partial<Settings>): void {
    this.settingsState.update((settings) => ({ ...settings, ...patch, id: SETTINGS_KEY }));
    const row = this.settingsState();
    this.schedule('settings', () => db.putSettings(row));
  }

  /**
   * Hold the newest write for each row, then send them together. A user who types in one
   * field produces one write, not one per keystroke.
   */
  private schedule(key: string, action: () => Promise<void>): void {
    this.pending.set(key, action);

    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(this.flushNow, WRITE_DELAY_MS);
  }

  private async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const actions = [...this.pending.values()];
    this.pending.clear();

    await Promise.all(actions.map((action) => action()));
  }

  private nextCollectionTitle(): string {
    return `Shop ${this.collectionsState().length + 1}`;
  }
}

function safe(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** True when every key of the patch already holds that value on the article. */
function same(article: Article, patch: Partial<Article>): boolean {
  return (Object.keys(patch) as (keyof Article)[]).every((key) => {
    const before = article[key];
    const after = patch[key];

    if (Array.isArray(before) && Array.isArray(after)) {
      return (
        before.length === after.length &&
        before.every((item, index) => shallowEqual(item, after[index]))
      );
    }

    return Object.is(before, after);
  });
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }

  const keys = Object.keys(a) as (keyof typeof a)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(a[key], (b as typeof a)[key]))
  );
}
