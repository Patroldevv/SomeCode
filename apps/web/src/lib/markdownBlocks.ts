/**
 * Splits agent markdown into top-level blocks so a streaming message re-parses only its last block: every
 * earlier block is a string that no longer changes, and a memoised renderer skips it.
 *
 * Rules (pure, prefix-stable: a boundary found in a prefix stays a boundary however the text grows):
 *  - a boundary is a run of blank lines OUTSIDE a fenced code block (``` or ~~~, CommonMark closing rules),
 *    followed by a line that starts in column 0 — an indented line continues the block (a list item's next
 *    paragraph, an indented code block), so lists keep their items' content;
 *  - an unterminated fence swallows the rest of the text (one block, as the parser sees it);
 *  - a link reference definition (`[x]: url`) or footnote definition (`[^1]: …`) can be used by any other
 *    block, so text containing one is NOT split at all (whole-document parse, as before);
 *  - separators stay attached to the block before them: `blocks.join('') === text`.
 */
export function splitMarkdownBlocks(text: string): string[] {
  if (DEFINITION.test(text)) return [text];
  const blocks: string[] = [];
  let current = '';
  let hasContent = false;
  let afterBlank = false;
  let fence: { char: string; length: number } | null = null;

  for (const line of text.split(/(?<=\n)/)) {
    const body = line.endsWith('\n') ? line.slice(0, line.endsWith('\r\n') ? -2 : -1) : line;
    if (fence !== null) {
      current += line;
      const close = CLOSE_FENCE.exec(body);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null;
      continue;
    }
    if (body.trim() === '') {
      current += line;
      if (hasContent) afterBlank = true;
      continue;
    }
    if (afterBlank && !/^[ \t]/.test(body)) {
      blocks.push(current);
      current = '';
    }
    afterBlank = false;
    hasContent = true;
    current += line;
    const open = OPEN_FENCE.exec(body);
    // A backtick fence's info string cannot contain a backtick (that line is inline code instead).
    if (open && !(open[1]![0] === '`' && open[2]!.includes('`'))) {
      fence = { char: open[1]![0]!, length: open[1]!.length };
    }
  }
  if (current !== '' || blocks.length === 0) blocks.push(current);
  return blocks;
}

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/**
 * A link reference or footnote definition anywhere in the text (`[^…]:` is a special case of `[…]:`), also
 * inside a blockquote or list item. Deliberately loose: a false positive only costs the optimisation.
 */
const DEFINITION = /^[ \t>]*\[[^\]\n]+\]:/m;
