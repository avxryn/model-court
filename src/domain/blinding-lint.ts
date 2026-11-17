/**
 * Owner-side blinding lint for imported answers (D-38). Warnings only: it
 * never edits text. Jurors would see these clues, so the judge may redact.
 */

export interface BlindingWarning {
  kind: 'email' | 'url' | 'phone' | 'greeting' | 'signoff' | 'length'
  message: string
}

/** Roughly the longest answer a generated party can give (512 output tokens). */
export const GENERATED_ANSWER_CHARS = 2_000

const CHECKS: Array<{ kind: BlindingWarning['kind']; pattern: RegExp; message: string }> = [
  { kind: 'email', pattern: /[^\s@]+@[^\s@]+\.[a-z]{2,}/i, message: 'Contains an email address.' },
  { kind: 'url', pattern: /\bhttps?:\/\/\S+|\bwww\.\S+/i, message: 'Contains a link.' },
  { kind: 'phone', pattern: /\+?\d[\d\s().-]{7,}\d/, message: 'Contains something that looks like a phone or ticket number.' },
  { kind: 'greeting', pattern: /^\s*(hi|hello|hey|dear|good (morning|afternoon|evening))\b/im, message: 'Starts with a personal greeting.' },
  { kind: 'signoff', pattern: /^\s*(thanks|thank you|regards|best|cheers|sincerely|kind regards)\b[^\n]{0,40}$/im, message: 'Has a sign-off line.' },
]

export function blindingWarnings(text: string): BlindingWarning[] {
  const warnings: BlindingWarning[] = CHECKS.filter((check) => check.pattern.test(text)).map(({ kind, message }) => ({ kind, message }))
  if (text.length > GENERATED_ANSWER_CHARS * 1.5) {
    warnings.push({ kind: 'length', message: `Much longer than a generated answer (about ${GENERATED_ANSWER_CHARS.toLocaleString('en-US')} characters at most), which can give the source away.` })
  }
  return warnings
}
