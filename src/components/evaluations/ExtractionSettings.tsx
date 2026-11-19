/**
 * The field list of a "pull fields from documents" case (spec 04 §3.1, D-88): a starter or a
 * pasted JSON Schema, checked in the browser against the portable subset with the fix for each
 * refused keyword, a simple builder for which fields must be filled, the standing warning, the
 * privacy line, and per-field comparison rules under "More". The server re-validates on save.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Fold } from '@/components/court/Fold'
import { Plain } from '@/components/court/Paper'
import type { FieldErrors } from '@/components/evaluations/DraftEditor'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { validateCompareRules, type CompareRules } from '@/domain/extraction/compare'
import { isOptional, leafFields, looksLikeIdentifier, validateAuthoringSchema, type ExtractionSchema, type ObjectNode, type SchemaNode } from '@/domain/extraction/schema'
import { EXTRACTION_STARTERS } from '@/domain/extraction/starters'
import type { ExtractionSettings } from '@/domain/kits/extraction'
import { LIMITS } from '@/domain/limits'
import { cn } from '@/lib/utils'

export const MUST_FILL_WARNING = "A field marked Must be filled can't be left empty, so when a document doesn't have it the model has to guess. Mark it May be empty unless every document has it."
export const FIELD_LIST_PRIVACY = "Field names, descriptions and allowed values are sent to OpenAI and Anthropic with every request, and Anthropic keeps a compiled copy of the schema for up to 24 hours. Don't put personal data in them."

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, message: "This isn't valid JSON yet." }
  }
}

/** Every property with its object, path and label, for the Must/May builder. */
function properties(node: ObjectNode, prefix = '', depth = 0): Array<{ path: string; name: string; parent: ObjectNode; node: SchemaNode; depth: number }> {
  return Object.entries(node.properties).flatMap(([name, child]) => {
    const path = `${prefix}/${name}`
    const nested = child.type === 'object' ? properties(child, path, depth + 1) : child.type === 'array' && child.items.type === 'object' ? properties(child.items, `${path}/*`, depth + 1) : []
    return [{ path, name, parent: node, node: child, depth }, ...nested]
  })
}

function typeLabel(node: SchemaNode): string {
  if (node.type === 'string') return node.enum ? `one of ${node.enum.join(', ')}` : node.format ? `text (${node.format})` : 'text'
  if (node.type === 'array') return node.items.type === 'object' ? 'list of items' : `list of ${typeLabel(node.items)}`
  if (node.type === 'object') return 'group'
  return node.type === 'integer' ? 'whole number' : node.type === 'number' ? 'number' : 'yes / no'
}

/** The schema with `name` of the object at `path`'s parent toggled in or out of `required`. */
function toggleRequired(schema: ExtractionSchema, target: ObjectNode, name: string): ExtractionSchema {
  const copy = JSON.parse(JSON.stringify(schema)) as ExtractionSchema
  const walk = (original: ObjectNode, clone: ObjectNode): boolean => {
    if (original === target) {
      const required = new Set(clone.required ?? [])
      if (required.has(name)) required.delete(name)
      else required.add(name)
      clone.required = Object.keys(clone.properties).filter((key) => required.has(key))
      return true
    }
    return Object.entries(original.properties).some(([key, child]) => {
      const cloned = clone.properties[key]
      if (child.type === 'object' && cloned.type === 'object') return walk(child, cloned)
      if (child.type === 'array' && child.items.type === 'object' && cloned.type === 'array' && cloned.items.type === 'object') return walk(child.items, cloned.items)
      return false
    })
  }
  walk(schema, copy)
  return copy
}

export function ExtractionSettingsFields({ settings, onChange, errors }: { settings: ExtractionSettings; onChange: (next: ExtractionSettings) => void; errors: FieldErrors }) {
  // Kept as typed, so half-written JSON stays in the box; only a parsed object reaches the draft.
  const [text, setText] = useState(() => pretty(settings.schema))
  const [rulesText, setRulesText] = useState(() => pretty(settings.compare))
  const [parseError, setParseError] = useState<string | null>(null)
  const [rulesError, setRulesError] = useState<string | null>(null)
  const checked = useMemo(() => validateAuthoringSchema(settings.schema), [settings.schema])
  const ruleIssues = useMemo(() => (checked.ok ? validateCompareRules(checked.schema, settings.compare) : []), [checked, settings.compare])
  const serverError = Object.entries(errors).find(([path]) => path === 'kit.settings' || path.startsWith('kit.settings.'))?.[1]

  const replaceSchema = (schema: ExtractionSchema) => {
    setText(pretty(schema))
    setParseError(null)
    onChange({ ...settings, schema })
  }

  const leaves = checked.ok ? leafFields(checked.schema) : []
  const nullable = checked.ok ? properties(checked.schema).filter((entry) => isOptional(entry.parent, entry.name)).length : 0

  return (
    <div className="mb-8 space-y-5 rounded-md border border-paper-rule px-4 py-4">
      <p className="court-label">
        Fields <Plain>what every party must return, as JSON</Plain>
      </p>
      <div className="space-y-2">
        <p id="starter-legend" className="text-sm font-medium">Start from</p>
        <div role="group" aria-labelledby="starter-legend" className="flex flex-wrap gap-2">
          {EXTRACTION_STARTERS.map((starter) => (
            <Button key={starter.id} size="sm" variant="outline" title={starter.description} onClick={() => replaceSchema(starter.schema)}>
              {starter.name}
            </Button>
          ))}
        </div>
      </div>

      <p className="flex gap-2 rounded-md bg-slip px-3 py-2 text-sm text-muted-foreground">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{MUST_FILL_WARNING}</span>
      </p>

      {checked.ok && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Fields in the field list</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-medium">Field</th>
                <th scope="col" className="py-1 pr-3 font-medium">Type</th>
                <th scope="col" className="py-1 font-medium">Filled</th>
              </tr>
            </thead>
            <tbody>
              {properties(checked.schema).map((entry) => {
                const optional = isOptional(entry.parent, entry.name)
                const idLike = (entry.node.type === 'integer' || entry.node.type === 'number') && looksLikeIdentifier(entry.name)
                return (
                  <tr key={entry.path} className="border-t border-border align-top">
                    <td className="py-1.5 pr-3" style={{ paddingLeft: `${entry.depth * 1.25}rem` }}>
                      <span className="font-medium">{entry.node.title?.trim() || entry.name}</span>
                      {entry.node.title && <span className="ml-1.5 typewriter text-xs text-muted-foreground">{entry.name}</span>}
                      {idLike && <span className="block text-xs text-warning">Use text for IDs, account numbers and phone numbers: long numbers lose digits.</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{typeLabel(entry.node)}</td>
                    <td className="py-1.5">
                      <Button size="xs" variant={optional ? 'ghost' : 'secondary'} aria-pressed={!optional} aria-label={`${entry.node.title?.trim() || entry.name}: ${optional ? 'may be empty' : 'must be filled'}. Toggle.`} onClick={() => replaceSchema(toggleRequired(checked.schema, entry.parent, entry.name))}>
                        {optional ? 'May be empty' : 'Must be filled'}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            {leaves.length} of {LIMITS.extraction.leafFields} fields · {nullable} of {LIMITS.extraction.nullableFields} may be empty
          </p>
        </div>
      )}

      <Fold summary={<span>Edit the field list as JSON Schema</span>} defaultOpen={!checked.ok} contentClassName="space-y-2">
        <Field className="gap-1.5">
          <FieldLabel htmlFor="kit-schema">Field list (JSON Schema)</FieldLabel>
          <Textarea
            id="kit-schema"
            rows={12}
            className="typewriter text-xs"
            spellCheck={false}
            value={text}
            aria-invalid={parseError || !checked.ok ? true : undefined}
            aria-describedby="kit-schema-help"
            onChange={(event) => {
              setText(event.target.value)
              const parsed = parseJson(event.target.value)
              if (!parsed.ok) return setParseError(parsed.message)
              setParseError(null)
              onChange({ ...settings, schema: parsed.value as ExtractionSchema })
            }}
          />
          <FieldDescription id="kit-schema-help" className="text-xs">
            Types object, array, string, number, integer and boolean; <code>required</code> lists the fields that must be filled; up to {LIMITS.extraction.leafFields} fields, {LIMITS.extraction.nullableFields} that may be empty, {LIMITS.extraction.depth} levels, {LIMITS.extraction.schemaBytes / 1024} KiB.
          </FieldDescription>
        </Field>
        {(parseError || !checked.ok || serverError) && (
          <ul aria-live="polite" className="space-y-1 text-sm text-destructive">
            {parseError && <li>{parseError}</li>}
            {!parseError && !checked.ok && checked.issues.slice(0, 8).map((issue, index) => <li key={index}>{issue.path ? <code className="mr-1 text-xs">{issue.path}</code> : null}{issue.message}</li>)}
            {!parseError && checked.ok && serverError && <li>{serverError}</li>}
          </ul>
        )}
      </Fold>

      <Fold summary={<span>More: how answers are compared with your answer keys</span>} defaultOpen={Object.keys(settings.compare).length > 0} contentClassName="space-y-2">
        <Field className="gap-1.5">
          <FieldLabel htmlFor="kit-compare">Comparison rules (JSON)</FieldLabel>
          <Textarea
            id="kit-compare"
            rows={4}
            className="typewriter text-xs"
            spellCheck={false}
            value={rulesText}
            aria-invalid={rulesError || ruleIssues.length > 0 ? true : undefined}
            aria-describedby="kit-compare-help"
            onChange={(event) => {
              setRulesText(event.target.value)
              const parsed = parseJson(event.target.value)
              if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) return setRulesError("Rules are a JSON object, for example {\"/total\": {\"tolerance\": 0.01}}.")
              setRulesError(null)
              onChange({ ...settings, compare: parsed.value as CompareRules })
            }}
          />
          <FieldDescription id="kit-compare-help" className={cn('text-xs', (rulesError || ruleIssues.length > 0) && 'text-destructive')}>
            {rulesError ??
              ruleIssues[0]?.message ??
              'By default text ignores case and spacing, numbers must be equal, dates the same day and lists match in any order. Per field: "exact", "alnum" (letters and digits only, for IDs), {"tolerance": 0.01}, "ordered", or {"matchBy": "sku"} for lists of items. Use * for list items, as in /lineItems/*/sku.'}
          </FieldDescription>
        </Field>
      </Fold>

      <p className="text-xs text-muted-foreground">{FIELD_LIST_PRIVACY}</p>
    </div>
  )
}
