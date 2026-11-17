/**
 * Text measurement rules shared by browser validation and server authority.
 * Lengths are Unicode code points (spec §5.3); byte caps are UTF-8.
 */

const encoder = new TextEncoder()

export function codePointLength(value: string): number {
  let count = 0
  for (const _ of value) count++
  return count
}

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength
}

/** C0/C1 control characters other than tab, line feed, and carriage return. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/

export function hasDisallowedControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value)
}
