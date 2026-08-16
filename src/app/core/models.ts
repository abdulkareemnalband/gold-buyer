/**
 * The three grades an Indian shop quotes on its rate board. The rate bar toggles between
 * these three. One piece of jewellery may carry any karat, so an article holds a plain
 * number instead.
 */
export type Karat = 24 | 22 | 18;

export const KARATS: readonly Karat[] = [24, 22, 18] as const;

/** Pure gold. No piece can go above this. */
export const MAX_KARAT = 24;

/** One shop visit. It holds its own gold rate, because every shop quotes its own. */
export interface Collection {
  id: string;
  title: string;
  /** Rate per gram of 24kt gold, in rupees. Every other karat derives from this. */
  pricePerGram24: number;
  /** The karat the rate bar currently shows. */
  displayKarat: Karat;
  createdAt: number;
}

/**
 * One kind of precious stone on a piece. A piece carries zero or more of these. The
 * weight adds to the total weight of the piece. The price is a flat amount.
 */
export interface Stone {
  id: string;
  /** The kind of stone, such as diamond or ruby. */
  kind: string;
  weightGrams: number;
  price: number;
}

/** One piece of jewellery inside a collection. */
export interface Article {
  id: string;
  collectionId: string;
  name: string;
  notes: string;
  /** Any karat from 1 to 24, not only the three on the rate board. */
  karat: number;
  /** Weight of the gold alone, in grams. The stones weigh separately. */
  goldWeightGrams: number;
  makingChargePercent: number;
  /** Zero or more stones. An empty list means plain gold. */
  stones: Stone[];
  /** True when the article counts towards the totals. */
  selected: boolean;
  createdAt: number;
}

/** One photo of an article. The blob holds the downscaled image. */
export interface ArticleImage {
  id: string;
  articleId: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

/** The single settings row. */
export interface Settings {
  id: 'app';
  activeCollectionId: string;
  /** Goods and Services Tax rate, as a percentage. India charges 3% on gold. */
  gstPercent: number;
}

export const SETTINGS_KEY = 'app';
export const DEFAULT_GST_PERCENT = 3;

/** One carat of stone weighs 0.2 grams. */
export const GRAMS_PER_CARAT = 0.2;
