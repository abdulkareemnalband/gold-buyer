/**
 * The three grades an Indian shop quotes on its rate board. The rate bar toggles between
 * these three. One piece of jewellery may carry any karat, so an article holds a plain
 * number instead.
 */
export type Karat = 24 | 22 | 18;

export const KARATS: readonly Karat[] = [24, 22, 18] as const;

/** Pure gold. No piece can go above this. */
export const MAX_KARAT = 24;

/** The metals a piece can be made of. Only gold carries a karat. */
export type Metal = 'gold' | 'silver' | 'platinum';

export const METALS: readonly Metal[] = ['gold', 'silver', 'platinum'] as const;

export const METAL_NAMES: Record<Metal, string> = {
  gold: 'Gold',
  silver: 'Silver',
  platinum: 'Platinum',
};

/** The unit a stone is weighed and priced in. */
export type StoneUnit = 'g' | 'ct';

export const STONE_UNITS: readonly StoneUnit[] = ['g', 'ct'] as const;

export const UNIT_NAMES: Record<StoneUnit, string> = { g: 'per gram', ct: 'per carat' };

/**
 * One gold rate that a shop quoted on one day. The user types the rate in any karat. The
 * app keeps the karat as typed, so the typed number never changes by a rounding step.
 */
export interface GoldRate {
  id: string;
  /** The day of the rate, as `YYYY-MM-DD`. */
  date: string;
  /** The karat of the typed rate, from 1 to 24. */
  karat: number;
  /** The price of one gram at that karat, in rupees. */
  rate: number;
}

/** The rate a shop quotes for one kind of stone, per gram or per carat. */
export interface StoneRate {
  id: string;
  /** The kind of stone, such as diamond or ruby. */
  kind: string;
  unit: StoneUnit;
  /** The price of one unit, in rupees. */
  rate: number;
}

/** One shop visit. It holds its own rates, because every shop quotes its own. */
export interface Collection {
  id: string;
  title: string;
  /**
   * The gold rates of this shop, one per day. The rate with the latest date is the rate
   * of today. A piece can take an older rate through its booking or purchase date.
   */
  goldRates: GoldRate[];
  /** The karat the rate bar currently shows. */
  displayKarat: Karat;
  /** Rate per gram of silver, in rupees. */
  silverPricePerGram: number;
  /** Rate per gram of platinum, in rupees. */
  platinumPricePerGram: number;
  /** The stone rates of this shop. A stone on a piece can use one of them. */
  stoneRates: StoneRate[];
  createdAt: number;
}

/**
 * One precious stone on a piece. A piece carries zero or more of these. The weight adds
 * to the total weight of the piece.
 */
export interface Stone {
  id: string;
  /** The kind of stone, such as diamond or ruby. */
  kind: string;
  /**
   * The id of the shop stone rate that prices this stone. An empty string means a flat
   * price that the user types.
   */
  rateId: string;
  /** The weight, in `unit`. */
  weight: number;
  unit: StoneUnit;
  /** The price of the stone. A stone with a shop rate gets this from the rate. */
  price: number;
}

/** One piece of jewellery inside a collection. */
export interface Article {
  id: string;
  collectionId: string;
  name: string;
  notes: string;
  metal: Metal;
  /** Any karat from 1 to 24, not only the three on the rate board. Gold only. */
  karat: number;
  /** Weight of the metal alone, in grams. The stones weigh separately. */
  weightGrams: number;
  makingChargePercent: number;
  /** The discount the shop gives on the making charge, as a percentage from 0 to 100. */
  makingDiscountPercent: number;
  /**
   * The day the customer booked the gold, as `YYYY-MM-DD`. An empty string means no
   * booking. The metal value uses the gold rate of this day. Gold only.
   */
  bookingDate: string;
  /**
   * The day the customer bought the piece, as `YYYY-MM-DD`. An empty string means the
   * booking date. The making charge uses the gold rate of this day. Gold only.
   */
  purchaseDate: string;
  /** Zero or more stones. An empty list means plain metal. */
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
