/**
 * Display-name sanitization for uploads.
 *
 * The name a client sends is only ever SHOWN — storage keys are random and never built from it.
 * It is still cleaned, because it travels into other people's screens and into a
 * `Content-Disposition` header:
 *
 *  - path parts are dropped (`../../x.pdf` → `x.pdf`, `C:\\a\\b.pdf` → `b.pdf`);
 *  - control characters, bidirectional overrides and zero-width characters are removed, so
 *    `invoice\u202Efdp.exe` cannot pose as `invoiceexe.pdf`;
 *  - leading dots are removed, so nothing becomes a dotfile;
 *  - the length is capped while keeping the extension.
 */
// Matching control characters is the point of this pattern, so the rule against them is off here.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Bidi embeddings/overrides/isolates and marks, plus zero-width characters and the BOM. */
const INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
const MAX_NAME_LENGTH = 180;

export interface SanitizedName {
  name: string;
  /** Lower-cased extension without the dot; '' when there is none. */
  extension: string;
}

export function sanitizeFileName(raw: string): SanitizedName {
  const base = raw.split(/[\\/]/).pop() ?? '';
  let name = base
    .normalize('NFC')
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim();

  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';

  if (name.length > MAX_NAME_LENGTH) {
    const suffix = extension ? `.${extension}` : '';
    name = `${name.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
  }

  if (name === '' || name === `.${extension}`) name = extension ? `file.${extension}` : 'file';
  return { name, extension };
}

/** An RFC 5987 `Content-Disposition` value that is safe for any display name. */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
