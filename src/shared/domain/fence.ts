declare const fenced: unique symbol;

/** Text that went through `fence`. Prompt builders take only `Fenced` for externally authored fields. */
export type Fenced = string & { readonly [fenced]: true };

/** Labels are written by code (`customer id=m1`), never by the people whose text is fenced. */
const LABEL = /^[\w .=-]+$/;
/** Zero-width characters and bidi controls, which can hide a `<<<` from the neutralisation. */
const INVISIBLE = /[​-‍⁠﻿‎‏؜‪-‮⁦-⁩]/g;

/**
 * Wraps externally authored text in recognisable delimiters. The text is NFKC-normalised (so a
 * full-width `＜＜＜` becomes `<<<`) and stripped of zero-width and bidi control characters, then
 * every `<<<` becomes `[fence]` (no `<`), so neither an opening nor a closing tag can be forged from
 * inside. Text that is already `Fenced` is refused at compile time, so nothing is fenced twice.
 */
export const fence = (label: string, text: string & { readonly [fenced]?: never }): Fenced => {
  if (!LABEL.test(label)) throw new Error(`Invalid fence label: ${JSON.stringify(label)}`);
  const neutralised = text.normalize('NFKC').replace(INVISIBLE, '').replaceAll('<<<', '[fence]');
  return `<<<${label}>>>\n${neutralised}\n<<<end ${label}>>>` as Fenced;
};
