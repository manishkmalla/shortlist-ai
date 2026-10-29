export type TextFileResult =
  | { ok: true; text: string }
  | { ok: false; code: 'wrong_type' | 'unsupported_encoding'; message: string };

/** U+FEFF written as an escape in a string, so no invisible character sits in the source. */
const BYTE_ORDER_MARK = new RegExp(`^${String.fromCharCode(0xfeff)}`);

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);

const WRONG_TYPE = 'This file does not look like a text file. Check that you chose the right file.';
const WRONG_ENCODING =
  'This text file is not saved as UTF-8. Save it as UTF-8, or paste your resume text instead.';

/**
 * Reads the bytes of an uploaded .txt as text. Looks at the bytes, not the file name: PDFs, zip archives
 * (including Word documents) and other binary files are refused, as is any encoding other than UTF-8.
 */
export function readTextFile(bytes: Uint8Array): TextFileResult {
  const isPdf = startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  const isZip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]); // PK..
  if (isPdf || isZip) return { ok: false, code: 'wrong_type', message: WRONG_TYPE };

  // UTF-16 and UTF-32 text start with a byte order mark and contain zero bytes, so check this first.
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) {
    return { ok: false, code: 'unsupported_encoding', message: WRONG_ENCODING };
  }
  if (bytes.includes(0)) return { ok: false, code: 'wrong_type', message: WRONG_TYPE };

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: 'unsupported_encoding', message: WRONG_ENCODING };
  }
  const text = decoded.replace(BYTE_ORDER_MARK, '').replace(/\r\n?/g, '\n');
  return { ok: true, text };
}
