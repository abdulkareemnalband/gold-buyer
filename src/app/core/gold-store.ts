import { computed, DestroyRef, inject, Service, signal } from '@angular/core';
import * as db from './gold-db';
import { computeTotals, latestGoldRate, Pricing, rate24, resolveStones } from './gold-math';
import { ImageStore } from './image-store';
import { migrateArticle, migrateCollection } from './migrate';
import {
  Article,
  Barcode,
  Collection,
  DEFAULT_BARCODE_TYPE,
  DEFAULT_GST_PERCENT,
  GoldRate,
  Karat,
  Settings,
  SETTINGS_KEY,
  StoneRate,
} from './models';

/** The shop details a user edits in the shop dialog. */
export type ShopDetails = Pick<
  Collection,
  'title' | 'goldRates' | 'silverPricePerGram' | 'platinumPricePerGram' | 'stoneRates'
>;

/** The fields the quick add sets on a new piece. */
export type NewArticle = Pick<
  Article,
  'name' | 'metal' | 'karat' | 'weightGrams' | 'makingChargePercent'
>;

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

  /** The gold rate with the latest date. The rate bar shows it. */
  readonly latestGoldRate = computed(() =>
    latestGoldRate(this.activeCollection()?.goldRates ?? []),
  );
  readonly pricePerGram24 = computed(() => {
    const latest = this.latestGoldRate();
    return latest ? rate24(latest) : 0;
  });
  readonly displayKarat = computed<Karat>(() => this.activeCollection()?.displayKarat ?? 22);
  readonly gstPercent = computed(() => this.settingsState().gstPercent);

  /**
   * Every rate of the active shop, plus the tax. The equality check keeps the same
   * object while the values hold, so a rename of the shop does not reprice the cards.
   */
  readonly pricing = computed<Pricing>(
    () => {
      const collection = this.activeCollection();
      return {
        goldRates: collection?.goldRates ?? [],
        silverPricePerGram: collection?.silverPricePerGram ?? 0,
        platinumPricePerGram: collection?.platinumPricePerGram ?? 0,
        gstPercent: this.settingsState().gstPercent,
        stoneRates: collection?.stoneRates ?? [],
      };
    },
    { equal: samePricing },
  );

  /** The totals cover the selected articles of the active collection only. */
  readonly totals = computed(() =>
    computeTotals(
      this.activeArticles().filter((article) => article.selected),
      this.pricing(),
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

  /**
   * A new collection starts from the latest gold rate and the other metal rates of the
   * active one, because a trip is one day. The stone rates belong to one shop, so they
   * start empty.
   */
  addCollection(details: Partial<ShopDetails> = {}): Collection {
    const active = this.activeCollection();
    const clean = cleanDetails(details);
    const collection: Collection = {
      id: crypto.randomUUID(),
      title: details.title?.trim() || this.suggestedTitle(),
      goldRates: clean.goldRates ?? copyLatest(active?.goldRates ?? []),
      displayKarat: active?.displayKarat ?? 22,
      silverPricePerGram: clean.silverPricePerGram ?? active?.silverPricePerGram ?? 0,
      platinumPricePerGram: clean.platinumPricePerGram ?? active?.platinumPricePerGram ?? 0,
      stoneRates: details.stoneRates ?? [],
      createdAt: Date.now(),
    };

    this.collectionsState.update((all) => [...all, collection]);
    this.schedule(`collection:${collection.id}`, () => db.putCollection(collection));
    this.setActiveCollection(collection.id);

    return collection;
  }

  setActiveCollection(id: string): void {
    this.patchSettings({ activeCollectionId: id });
  }

  setDisplayKarat(displayKarat: Karat): void {
    const id = this.activeCollection()?.id;

    if (id) {
      this.patchCollection(id, { displayKarat });
    }
  }

  /**
   * Set the details of the active shop.
   *
   * A stone rate that leaves the list turns every stone that used it into a flat-price
   * stone, with the price it had. An open article card does the same on its own.
   */
  updateShop(patch: Partial<ShopDetails>): void {
    const collection = this.activeCollection();

    if (!collection) {
      return;
    }

    const clean = cleanDetails(patch);
    if (patch.title !== undefined) {
      clean.title = patch.title.trim() || collection.title;
    }

    if (patch.stoneRates) {
      const kept = new Set(patch.stoneRates.map((rate) => rate.id));

      if (collection.stoneRates.some((rate) => !kept.has(rate.id))) {
        this.unlinkStones(collection.id, collection.stoneRates, kept);
      }
    }

    this.patchCollection(collection.id, clean);
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

    // With no shop left, the shell asks for a new one.
    if (this.settingsState().activeCollectionId === id) {
      this.setActiveCollection(this.collectionsState()[0]?.id ?? '');
    }
  }

  /**
   * Copy one collection with its rates, its articles, and their photos. The copy becomes
   * the active collection.
   *
   * Every row gets a new id. A copied stone links to the copy of its stone rate, so a
   * rate change in one shop does not touch the other.
   */
  duplicateCollection(id: string): Collection | undefined {
    const source = this.collectionsState().find((one) => one.id === id);

    if (!source) {
      return undefined;
    }

    const rateIds = new Map(source.stoneRates.map((rate) => [rate.id, crypto.randomUUID()]));
    const now = Date.now();
    const collection: Collection = {
      ...source,
      id: crypto.randomUUID(),
      title: `${source.title} (copy)`,
      goldRates: source.goldRates.map((rate) => ({ ...rate, id: crypto.randomUUID() })),
      stoneRates: source.stoneRates.map((rate) => ({ ...rate, id: rateIds.get(rate.id)! })),
      createdAt: now,
    };

    this.collectionsState.update((all) => [...all, collection]);
    this.schedule(`collection:${collection.id}`, () => db.putCollection(collection));

    // The step of one millisecond keeps the copies in the order of the originals.
    this.articlesState()
      .filter((article) => article.collectionId === id)
      .sort((a, b) => a.createdAt - b.createdAt)
      .forEach((article, index) =>
        this.copyArticle(article, collection.id, rateIds, article.name, now + index),
      );

    this.setActiveCollection(collection.id);
    return collection;
  }

  /** How many articles a delete would take with it. */
  articleCount(collectionId: string): number {
    return this.articlesState().filter((article) => article.collectionId === collectionId).length;
  }

  // --- Articles ------------------------------------------------------------------

  /** Add a piece to the active collection. The quick add passes the main fields. */
  addArticle(start: Partial<NewArticle> & { barcode?: Barcode } = {}): Article | undefined {
    const collection = this.activeCollection();

    if (!collection) {
      return undefined;
    }

    const article: Article = {
      id: crypto.randomUUID(),
      collectionId: collection.id,
      name: start.name?.trim() ?? '',
      notes: '',
      barcode: start.barcode ?? { data: '', type: DEFAULT_BARCODE_TYPE },
      metal: start.metal ?? 'gold',
      karat: start.karat ?? collection.displayKarat,
      weightGrams: Math.max(0, safe(start.weightGrams ?? 0)),
      makingChargePercent: safe(start.makingChargePercent ?? 0),
      makingDiscountPercent: 0,
      makingOnStones: false,
      bookingDate: '',
      purchaseDate: '',
      stones: [],
      selected: true,
      createdAt: Date.now(),
    };

    this.articlesState.update((all) => [...all, article]);
    this.schedule(`article:${article.id}`, () => db.putArticle(article));

    return article;
  }

  /** Copy one article, with its photos, into the same collection. The copy goes last. */
  duplicateArticle(id: string): Article | undefined {
    const source = this.articlesState().find((article) => article.id === id);

    if (!source) {
      return undefined;
    }

    const name = `${source.name.trim() || 'Unnamed piece'} (copy)`;
    return this.copyArticle(source, source.collectionId, new Map(), name, Date.now());
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

  /**
   * Add a copy of one article with a new id. `rateIds` maps an old stone rate id to the
   * id of its copy. A stone rate that is not in the map keeps its id.
   */
  private copyArticle(
    source: Article,
    collectionId: string,
    rateIds: ReadonlyMap<string, string>,
    name: string,
    createdAt: number,
  ): Article {
    const article: Article = {
      ...source,
      id: crypto.randomUUID(),
      collectionId,
      name,
      stones: source.stones.map((stone) => ({
        ...stone,
        id: crypto.randomUUID(),
        rateId: rateIds.get(stone.rateId) ?? stone.rateId,
      })),
      createdAt,
    };

    this.articlesState.update((all) => [...all, article]);
    this.schedule(`article:${article.id}`, () => db.putArticle(article));
    void this.images.copy(source.id, article.id);

    return article;
  }

  // --- Loading and writing -------------------------------------------------------

  private async load(): Promise<void> {
    const snapshot = await db.loadSnapshot();

    this.collectionsState.set(
      snapshot.collections.map(migrateCollection).sort((a, b) => a.createdAt - b.createdAt),
    );
    this.articlesState.set(snapshot.articles.map(migrateArticle));

    if (snapshot.settings) {
      this.settingsState.set(snapshot.settings);
    }

    // With no shop at all, the shell asks for the first one.
    const active = this.activeCollection();
    if (active && this.settingsState().activeCollectionId !== active.id) {
      this.setActiveCollection(active.id);
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

  /** Turn every stone that uses one of the removed rates into a flat-price stone. */
  private unlinkStones(
    collectionId: string,
    before: readonly StoneRate[],
    kept: ReadonlySet<string>,
  ): void {
    const removed = new Set(before.filter((rate) => !kept.has(rate.id)).map((rate) => rate.id));

    for (const article of this.articlesState()) {
      if (
        article.collectionId !== collectionId ||
        !article.stones.some((stone) => removed.has(stone.rateId))
      ) {
        continue;
      }

      // Price each stone from the old list first, then drop the link.
      const stones = resolveStones(article.stones, before).map((stone) =>
        removed.has(stone.rateId) ? { ...stone, rateId: '' } : stone,
      );
      this.patchArticle(article.id, { stones });
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

  /** The name a new shop gets when the user types none. */
  suggestedTitle(): string {
    return `Shop ${this.collectionsState().length + 1}`;
  }
}

/** Keep every rate in the patch finite and not below zero. */
function cleanDetails(patch: Partial<ShopDetails>): Partial<ShopDetails> {
  const clean: Partial<ShopDetails> = { ...patch };

  for (const key of ['silverPricePerGram', 'platinumPricePerGram'] as const) {
    const value = patch[key];
    if (value !== undefined) {
      clean[key] = Math.max(0, safe(value));
    }
  }

  if (patch.goldRates) {
    clean.goldRates = patch.goldRates.map((rate) => ({
      ...rate,
      karat: Math.min(24, Math.max(1, safe(rate.karat) || 24)),
      rate: Math.max(0, safe(rate.rate)),
    }));
  }
  return clean;
}

/** The latest gold rate of a list, as a new row with its own id. */
function copyLatest(rates: readonly GoldRate[]): GoldRate[] {
  const latest = latestGoldRate(rates);
  return latest ? [{ ...latest, id: crypto.randomUUID() }] : [];
}

function samePricing(a: Pricing, b: Pricing): boolean {
  return (
    sameRows(a.goldRates, b.goldRates) &&
    a.silverPricePerGram === b.silverPricePerGram &&
    a.platinumPricePerGram === b.platinumPricePerGram &&
    a.gstPercent === b.gstPercent &&
    sameRows(a.stoneRates, b.stoneRates)
  );
}

function sameRows(a: readonly object[], b: readonly object[]): boolean {
  return a.length === b.length && a.every((row, index) => shallowEqual(row, b[index]));
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

    // The barcode is a small object. Compare it by its values, like a stone.
    if (isPlainObject(before) && isPlainObject(after)) {
      return shallowEqual(before, after);
    }

    return Object.is(before, after);
  });
}

function isPlainObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
