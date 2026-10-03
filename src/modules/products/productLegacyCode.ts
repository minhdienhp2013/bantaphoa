/**
 * LEGACY PRODUCT CODE COMPATIBILITY CONTRACT
 *
 * Equivalent output contract of the historical VBA TaoMaHang().
 *
 * Do not change this algorithm casually.
 * Any intentional change requires updating compatibility tests
 * and Central approval.
 */
export function generateLegacyProductCode(productName: string): string {
  let text = String(productName ?? '').toLocaleLowerCase('vi');

  // Historical VBA treats these separators as spaces.
  text = text
    .replace(/-/g, ' ')
    .replace(/\(/g, ' ')
    .replace(/\)/g, ' ')
    .replace(/\//g, ' ')
    .replace(/,/g, ' ');

  // Vietnamese đ is not removed by Unicode decomposition.
  text = text.replace(/đ/g, 'd');

  // Equivalent intent of the VBA AscW accent-removal table.
  text = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Equivalent intent of WorksheetFunction.Trim:
  // trim edges + collapse repeated whitespace.
  text = text.trim().replace(/\s+/g, ' ');

  if (!text) return '';

  let result = '';

  for (const word of text.split(' ')) {
    if (!word) continue;

    // VBA:
    // If IsNumeric(Left(tu, 1)) Then
    //     ketQua = ketQua & tu
    //
    // Numeric-leading tokens are kept in full:
    // 1m, 1m2, 80, 80.5t, 70*90, 12p...
    if (/^[0-9]/.test(word)) {
      result += word;
      continue;
    }

    // All other tokens contribute the first character.
    // "+" is intentionally preserved when it is a standalone token.
    result += word.charAt(0);
  }

  return result;
}
