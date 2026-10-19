/**
 * True when the text contains a character outside Unicode whitespace and format categories,
 * so zero-width spaces (U+200B), BOMs (U+FEFF), and ZWJ/ZWNJ-only runs count as empty for
 * display and grouping, while emoji ZWJ sequences and text with real content stay visible.
 */
export function hasVisibleText(text: string) {
  return /[^\s\p{Cf}]/u.test(text)
}
