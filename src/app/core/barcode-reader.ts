import { Service } from '@angular/core';
import { Barcode, DEFAULT_BARCODE_TYPE } from './models';

/**
 * Reads a barcode from a camera photo, and draws a barcode from a stored value.
 *
 * Both libraries are large, so each one loads on first use and stays out of the main
 * bundle. `@zxing/library` reads the photo. It is plain JavaScript, so it works offline.
 * `bwip-js` draws the barcode as SVG. The app keeps the value and the format only, never
 * the photo.
 */

/** The message when a photo shows no barcode that the reader can decode. */
export const NO_BARCODE = 'No barcode found. Take the photo again, close up and in focus.';

/** The formats a user can pick for a typed value. A scan can set any of them. */
export const BARCODE_TYPES: readonly { id: string; label: string }[] = [
  { id: 'code128', label: 'Code 128' },
  { id: 'qrcode', label: 'QR code' },
  { id: 'microqrcode', label: 'Micro QR code' },
  { id: 'ean13', label: 'EAN-13' },
  { id: 'ean8', label: 'EAN-8' },
  { id: 'upca', label: 'UPC-A' },
  { id: 'upce', label: 'UPC-E' },
  { id: 'code39', label: 'Code 39' },
  { id: 'code93', label: 'Code 93' },
  { id: 'interleaved2of5', label: 'ITF' },
  { id: 'rationalizedCodabar', label: 'Codabar' },
  { id: 'datamatrix', label: 'Data Matrix' },
  { id: 'pdf417', label: 'PDF417' },
  { id: 'azteccode', label: 'Aztec' },
  { id: 'databaromni', label: 'GS1 DataBar' },
  { id: 'databarexpanded', label: 'GS1 DataBar Expanded' },
  { id: 'maxicode', label: 'MaxiCode' },
];

/** The name of a barcode type for a label, such as QR code. */
export function barcodeTypeName(type: string): string {
  const id = type || DEFAULT_BARCODE_TYPE;
  return BARCODE_TYPES.find((one) => one.id === id)?.label ?? id;
}

/**
 * The zxing format name and the matching `bwip-js` symbology. A scan stores the
 * `bwip-js` name, so the drawing uses the same format as the tag.
 */
const FORMATS: Record<string, string> = {
  AZTEC: 'azteccode',
  CODABAR: 'rationalizedCodabar',
  CODE_39: 'code39',
  CODE_93: 'code93',
  CODE_128: 'code128',
  DATA_MATRIX: 'datamatrix',
  EAN_8: 'ean8',
  EAN_13: 'ean13',
  ITF: 'interleaved2of5',
  MAXICODE: 'maxicode',
  MICRO_QR_CODE: 'microqrcode',
  PDF_417: 'pdf417',
  QR_CODE: 'qrcode',
  RSS_14: 'databaromni',
  RSS_EXPANDED: 'databarexpanded',
  UPC_A: 'upca',
  UPC_E: 'upce',
};

/** The two-dimensional formats. They draw square, with no text under them. */
const MATRIX_FORMATS = new Set([
  'azteccode',
  'datamatrix',
  'maxicode',
  'microqrcode',
  'qrcode',
  'pdf417',
]);

/**
 * The longest side, in pixels, of each read attempt. A smaller photo reads faster. A
 * larger one keeps the bars of a small or far code apart.
 */
const READ_SIZES = [1600, 1000, 2400];

/** A rectangle inside an image, as fractions of its width and height. */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FULL_AREA: Area = { x: 0, y: 0, width: 1, height: 1 };

/**
 * The guide box in the middle of the camera view. The reader looks inside it first, so a
 * price tag or another code beside the barcode does not get in the way.
 *
 * A tall frame gets a wide, low box, which fits a 1D barcode and a QR code. A wide frame
 * gets a box that is taller, so a QR code still fits.
 */
export function guideArea(width: number, height: number): Area {
  return height >= width
    ? { x: 0.1, y: 0.3, width: 0.8, height: 0.4 }
    : { x: 0.2, y: 0.15, width: 0.6, height: 0.7 };
}

interface Decoders {
  zxing: typeof import('@zxing/library');
  hints: Map<number, unknown>;
  readers: { decode(image: unknown, hints: unknown): ZxingResult; reset(): void }[];
}

interface ZxingResult {
  getText(): string;
  getBarcodeFormat(): number;
}

@Service()
export class BarcodeReader {
  private decoders: Promise<Decoders> | undefined;

  /**
   * The first barcode in the photo, or null when the photo shows none. The reader looks
   * in the middle of the photo first, then in the whole photo.
   */
  async read(photo: Blob): Promise<Barcode | null> {
    const bitmap = await createImageBitmap(photo);

    try {
      for (const area of [guideArea(bitmap.width, bitmap.height), FULL_AREA]) {
        for (const size of READ_SIZES) {
          const barcode = await this.readArea(bitmap, bitmap.width, bitmap.height, area, size);
          if (barcode) {
            return barcode;
          }
        }
      }
      return null;
    } finally {
      bitmap.close();
    }
  }

  /**
   * Read one area of an image source, such as a video frame. The area is drawn at most
   * `size` pixels on its longest side. A smaller size reads faster, which matters for a
   * live camera that reads several frames each second.
   */
  async readArea(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    area: Area,
    size: number,
  ): Promise<Barcode | null> {
    const { zxing, hints, readers } = await this.load();
    const { pixels, width, height } = grayscale(source, sourceWidth, sourceHeight, area, size);
    const image = new zxing.BinaryBitmap(
      new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(pixels, width, height)),
    );

    for (const reader of readers) {
      try {
        const result = reader.decode(image, hints);
        const name = zxing.BarcodeFormat[result.getBarcodeFormat()];
        return { data: result.getText(), type: FORMATS[name] ?? DEFAULT_BARCODE_TYPE };
      } catch {
        // A reader throws when it finds no code of its format. Try the next one.
      } finally {
        reader.reset();
      }
    }
    return null;
  }

  /** Load the library once, and make the readers once. */
  private load(): Promise<Decoders> {
    this.decoders ??= import('@zxing/library').then((zxing) => {
      const hints = new Map<number, unknown>([[zxing.DecodeHintType.TRY_HARDER, true]]);

      // The same readers, in the same order, as `MultiFormatReader`. The app calls them
      // one by one, because `MultiFormatReader` in version 0.23 logs a warning for every
      // reader that finds no code, which is the normal case.
      const readers = [
        new zxing.MultiFormatOneDReader(hints),
        new zxing.QRCodeReader(),
        new zxing.MicroQRCodeReader(),
        new zxing.DataMatrixReader(),
        new zxing.AztecCodeReader(),
        new zxing.PDF417Reader(),
        new zxing.MaxiCodeReader(),
      ];

      return { zxing, hints, readers };
    });
    return this.decoders;
  }

  /**
   * An SVG data URL of the barcode in its own type, or null when the data does not fit
   * that type, such as letters under EAN-13. The type never changes in silence, because
   * a tag in another format would not match the records of the shop.
   */
  async render(barcode: Barcode): Promise<string | null> {
    const text = barcode.data.trim();

    if (!text) {
      return null;
    }

    const bwip = await import('bwip-js/browser');
    const bcid = barcode.type || DEFAULT_BARCODE_TYPE;
    const matrix = MATRIX_FORMATS.has(bcid);

    try {
      // A 2D code sets its own height. `bwip-js` rejects an option set to `undefined`, so a
      // 2D code must leave the `height` key out, not set it to `undefined`.
      const svg = bwip.toSVG({
        bcid,
        text,
        scale: 3,
        ...(matrix ? {} : { height: 12, includetext: true, textxalign: 'center' as const }),
        paddingwidth: 4,
        paddingheight: 4,
        backgroundcolor: 'FFFFFF',
      });
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch {
      // The data does not fit the type.
    }
    return null;
  }
}

/**
 * Draw one area of the source at most `size` pixels on its longest side, and keep one byte
 * per pixel.
 */
function grayscale(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  area: Area,
  size: number,
) {
  const sx = Math.round(area.x * sourceWidth);
  const sy = Math.round(area.y * sourceHeight);
  const sw = Math.max(1, Math.round(area.width * sourceWidth));
  const sh = Math.max(1, Math.round(area.height * sourceHeight));

  const scale = Math.min(1, size / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('No 2D canvas.');
  }
  context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);

  const rgba = context.getImageData(0, 0, width, height).data;
  const pixels = new Uint8ClampedArray(width * height);
  for (let at = 0; at < pixels.length; at++) {
    const i = at * 4;
    // The usual luma weights, in whole numbers out of 256.
    pixels[at] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }

  return { pixels, width, height };
}
