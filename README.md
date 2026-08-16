# Gold Buyer

A helper for a buyer who stands in a jewellery shop and must check the shopkeeper's
price on the spot. It works offline after the first page load. Every price is in Indian
rupees.

## What it does

- **A shop per collection.** Each collection stands for one shop visit. It carries its
  own 24kt rate, because every shop quotes its own. A new collection copies the rate
  from the open one.
- **One rate, three views.** The app stores the 24kt rate alone. The toggle picks the
  karat the field shows, and an edit in that karat lifts back to the 24kt rate.
- **Any karat per piece.** The three buttons are shortcuts. The field takes any karat
  from 1 to 24.
- **Zero or more stones.** Each stone carries a kind, a weight, and a flat price. The
  weight adds to the total weight of the piece. The gold price uses the gold weight
  alone.
- **Prices in both directions.** See the next section.
- **Notes and photos.** A photo comes from the file picker or the camera. The app
  downscales it to 1600 pixels and stores WebP, near 150 to 300 kB.
- **Pick what you will buy.** The totals cover the selected pieces of the open shop.
- **Everything stays in IndexedDB.** No account, no server, no network call.

## How a price is calculated

Forward, per piece:

1. `ratePerGram = pricePerGram24 * karat / 24`
2. `goldPrice = goldWeightGrams * ratePerGram`
3. `makingCharge = makingChargePercent / 100 * goldPrice`
4. `priceBeforeTax = goldPrice + makingCharge + stonePrice`
5. `tax = priceBeforeTax * 3 / 100`
6. `priceAfterTax = priceBeforeTax + tax`

Backward, so you can type the number the shopkeeper says:

| You type | The app solves |
| --- | --- |
| Gold price of the piece | the gold weight |
| Making charge amount | the making charge percentage |
| Price before tax | the making charge percentage |
| Price after tax | the making charge percentage |

The last three divide by the gold price. The app disables them until a weight and a
rate give a gold price above zero.

A typed price below the metal cost drives the making charge negative. The app permits
this and marks it as a discount.

The app holds the number you typed until you change a source field or the shop rate. A
weight rounds to 4 decimal places, so a stored weight can move a price by up to half a
rupee once the typed number gives way.

## Development

```bash
npm start
```

```bash
npm test
```

The price engine has no framework in it. `src/app/core/gold-math.ts` and
`src/app/core/article-form.ts` are pure functions, and their suites prove both
directions of the calculation.

## Deployment

A push to `main` builds the app and publishes it to GitHub Pages. The workflow lives in
`.github/workflows/deploy.yml`. It runs the tests first, then builds with the base href
`/gold-buyer/`.

The repository needs a remote before the first deployment:

```bash
gh repo create gold-buyer --public --source . --remote origin --push
```

Then open **Settings, then Pages** and set **Source** to **GitHub Actions**. The app
appears at `https://<your-user>.github.io/gold-buyer/`.

To check the deployed path on your own machine:

```bash
npm run build:pages
```

## Notes on the toolchain

Angular 22 supports Node 22.22.3 and up, or Node 24.15 and up. This machine runs Node
25, which the CLI reports as unsupported and then builds anyway. The workflow uses Node
24, the current long term release.
