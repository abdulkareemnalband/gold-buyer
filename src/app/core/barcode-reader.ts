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
  PDF_417: 'pdf417',
  QR_CODE: 'qrcode',
  RSS_14: 'databaromni',
  RSS_EXPANDED: 'databarexpanded',
  UPC_A: 'upca',
  UPC_E: 'upce',
};

/** The two-dimensional formats. They draw square, with no text under them. */
const MATRIX_FORMATS = new Set(['azteccode', 'datamatrix', 'maxicode', 'qrcode', 'pdf417']);

/**
 * The longest side, in pixels, of each read attempt. A smaller photo reads faster. A
 * larger one keeps the bars of a small or far code apart.
 */
const READ_SIZES = [1600, 1000, 2400];

@Service()
export class BarcodeReader {
  /** The first barcode in the photo, or null when the photo shows none. */
  async read(photo: Blob): Promise<Barcode | null> {
    const zxing = await import('@zxing/library');
    const bitmap = await createImageBitmap(photo);

    try {
      const reader = new zxing.MultiFormatReader();
      reader.setHints(new Map([[zxing.DecodeHintType.TRY_HARDER, true]]));

      for (const size of READ_SIZES) {
        const { pixels, width, height } = grayscale(bitmap, size);
        const source = new zxing.RGBLuminanceSource(pixels, width, height);
        const image = new zxing.BinaryBitmap(new zxing.HybridBinarizer(source));

        try {
          const result = reader.decode(image);
          const name = zxing.BarcodeFormat[result.getBarcodeFormat()];
          return { data: result.getText(), type: FORMATS[name] ?? DEFAULT_BARCODE_TYPE };
        } catch {
          // zxing throws when it finds no code. Try the next size.
        } finally {
          reader.reset();
        }
      }
      return null;
    } finally {
      bitmap.close();
    }
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
      const svg = bwip.toSVG({
        bcid,
        text,
        scale: 3,
        height: matrix ? undefined : 12,
        includetext: !matrix,
        textxalign: 'center',
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

/** Draw the photo at most `size` pixels on its longest side, and keep one byte per pixel. */
function grayscale(bitmap: ImageBitmap, size: number) {
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('No 2D canvas.');
  }
  context.drawImage(bitmap, 0, 0, width, height);

  const rgba = context.getImageData(0, 0, width, height).data;
  const pixels = new Uint8ClampedArray(width * height);
  for (let at = 0; at < pixels.length; at++) {
    const i = at * 4;
    // The usual luma weights, in whole numbers out of 256.
    pixels[at] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }

  return { pixels, width, height };
}
