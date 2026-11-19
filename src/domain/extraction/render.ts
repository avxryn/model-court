/**
 * What jurors see of an extraction (spec 04 §3.2, §8.1). Pure and browser-safe.
 *
 * Jurors never see a provider's bytes for a parsed answer: whitespace, key order, escapes and
 * number spelling could identify a party. The server parses the output and renders it again in
 * the authoring schema's order (`canonicalExtractionJson`), and the worksheet shows it as field
 * rows (`renderFields`). An enum value that differs from the schema only in capitalization is
 * shown in the schema's spelling. Objects are built with a null prototype and only from schema
 * names, so no output key can reach a prototype.
 */

import type { ExtractionSchema, FieldPath, SchemaNode } from './schema'

export type ParsedOutput = { status: 'parsed'; value: unknown } | { status: 'unparsed' }

/** `JSON.parse` of the trimmed text, with no fence stripping or repair (the `json-parse` rule). */
export function parseOutput(text: string): ParsedOutput {
  const trimmed = text.trim()
  if (trimmed === '') return { status: 'unparsed' }
  try {
    return { status: 'parsed', value: JSON.parse(trimmed) as unknown }
  } catch {
    return { status: 'unparsed' }
  }
}

function enumSpelling(node: SchemaNode, value: string): string {
  if (node.type !== 'string' || !node.enum || node.enum.includes(value)) return value
  const lower = value.toLowerCase()
  return node.enum.find((item) => item.toLowerCase() === lower) ?? value
}

function sortedPlain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedPlain)
  if (value === null || typeof value !== 'object') return value
  const out = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = sortedPlain((value as Record<string, unknown>)[key])
  return out
}

/** The value re-ordered by the schema: schema properties first, in authoring order, then any extra keys sorted. */
export function canonicalByAuthoringOrder(schema: SchemaNode, value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null
  if (schema.type === 'object' && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const out = Object.create(null) as Record<string, unknown>
    for (const [name, child] of Object.entries(schema.properties)) if (Object.hasOwn(record, name)) out[name] = canonicalByAuthoringOrder(child, record[name])
    for (const key of Object.keys(record).filter((key) => !Object.hasOwn(schema.properties, key)).sort()) out[key] = sortedPlain(record[key])
    return out
  }
  if (schema.type === 'array' && Array.isArray(value)) return value.map((item) => canonicalByAuthoringOrder(schema.items, item))
  if (typeof value === 'string') return enumSpelling(schema, value)
  return sortedPlain(value)
}

/** The text jurors see for a parsed answer (two-space indent). */
export function canonicalExtractionJson(schema: ExtractionSchema, value: unknown): string {
  return JSON.stringify(canonicalByAuthoringOrder(schema, value), null, 2)
}

export type RenderedField =
  /** A heading row: an object field, a list, or one item of a list. */
  | { kind: 'group'; path: FieldPath; label: string; depth: number; empty: boolean }
  /** A value row. `value` is null when the field was left empty; `path` names a leaf a juror may flag. */
  | { kind: 'value'; path: FieldPath; label: string; depth: number; value: string | null }

export const RENDERED_FIELDS_MAX = 500

function labelOf(name: string, node: SchemaNode): string {
  return node.title?.trim() || name
}

function display(node: SchemaNode, value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() === '' ? null : enumSpelling(node, value)
  if (typeof value === 'number' || typeof value === 'boolean') return node.type === 'boolean' && typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
  return JSON.stringify(sortedPlain(value))
}

/**
 * Field rows in schema order. Nested objects become indented groups, list items numbered
 * groups (objects) or numbered values (scalars). A value of the wrong shape is shown as compact
 * JSON on its row; keys outside the schema are not rows (the JSON view still shows them).
 */
export function renderFields(schema: ExtractionSchema, value: unknown): RenderedField[] {
  const rows: RenderedField[] = []
  const push = (row: RenderedField) => {
    if (rows.length < RENDERED_FIELDS_MAX) rows.push(row)
  }
  const visit = (node: SchemaNode, current: unknown, path: FieldPath, label: string, depth: number) => {
    if (node.type === 'object' && current !== null && typeof current === 'object' && !Array.isArray(current)) {
      if (path !== '') push({ kind: 'group', path, label, depth, empty: false })
      for (const [name, child] of Object.entries(node.properties)) {
        visit(child, Object.hasOwn(current, name) ? (current as Record<string, unknown>)[name] : undefined, `${path}/${name}`, labelOf(name, child), path === '' ? depth : depth + 1)
      }
      return
    }
    if (node.type === 'array' && Array.isArray(current)) {
      push({ kind: 'group', path, label, depth, empty: current.length === 0 })
      current.forEach((item, index) => {
        const itemPath = `${path}/${index}`
        if (node.items.type === 'object') visit(node.items, item, itemPath, `${label} ${index + 1}`, depth + 1)
        else push({ kind: 'value', path: itemPath, label: String(index + 1), depth: depth + 1, value: display(node.items, item) })
      })
      return
    }
    if ((node.type === 'object' || node.type === 'array') && (current === null || current === undefined)) {
      push({ kind: 'value', path, label, depth, value: null })
      return
    }
    push({ kind: 'value', path, label, depth, value: display(node, current) })
  }
  visit(schema, value, '', '', 0)
  return rows
}

/** Leaf paths a juror may flag on this answer: exactly the value rows the worksheet shows. */
export function flaggablePaths(schema: ExtractionSchema, value: unknown): Set<FieldPath> {
  return new Set(renderFields(schema, value).flatMap((row) => (row.kind === 'value' ? [row.path] : [])))
}

/** `lineItems[2].amount` for `/lineItems/2/amount`, using titles where the schema has them. */
export function describePath(schema: ExtractionSchema, path: FieldPath): string {
  let node: SchemaNode | null = schema
  let out = ''
  for (const segment of path.split('/').slice(1)) {
    if (node?.type === 'object' && Object.hasOwn(node.properties, segment)) {
      const child: SchemaNode = node.properties[segment]
      out += `${out ? '.' : ''}${child.title?.trim() || segment}`
      node = child
    } else if (node?.type === 'array') {
      out += `[${Number(segment) + 1}]`
      node = node.items
    } else {
      out += `${out ? '.' : ''}${segment}`
      node = null
    }
  }
  return out || '(the whole answer)'
}
