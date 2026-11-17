/**
 * A minimal D1-compatible facade over any executor that runs a list of
 * statements atomically and returns rows plus change counts. It implements
 * exactly the subset Model Court uses: prepare/bind/first/all/run and batch.
 *
 * Production executor: the app-owned SQLite Durable Object (`ModelCourtStore`),
 * which runs every call inside `transactionSync` — so a batch commits or rolls
 * back as a whole, the same guarantee the guarded-transaction protocol relies on.
 * See docs/decisions.md D-20.
 */

export interface StoreStatement {
  sql: string
  params: Array<string | number | null>
}

export interface StoreResult {
  rows: Record<string, unknown>[]
  changes: number
}

export type StoreExecutor = (statements: StoreStatement[]) => Promise<StoreResult[]>

function normalize(value: unknown): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' || typeof value === 'string') return value
  throw new TypeError('Unsupported SQL parameter type')
}

function toD1Result<T>(result: StoreResult): D1Result<T> {
  return {
    results: result.rows as T[],
    success: true,
    meta: { changes: result.changes, duration: 0, last_row_id: 0, changed_db: result.changes > 0, size_after: 0, rows_read: 0, rows_written: result.changes },
  } as D1Result<T>
}

class BatchStatement {
  constructor(
    readonly executor: StoreExecutor,
    readonly sql: string,
    readonly params: Array<string | number | null> = [],
  ) {}

  bind(...values: unknown[]): BatchStatement {
    return new BatchStatement(this.executor, this.sql, values.map(normalize))
  }

  toStatement(): StoreStatement {
    return { sql: this.sql, params: this.params }
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const [result] = await this.executor([this.toStatement()])
    const row = result.rows[0]
    if (!row) return null
    return (column ? row[column] : row) as T
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const [result] = await this.executor([this.toStatement()])
    return toD1Result<T>(result)
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.all<T>()
  }
}

export class SqlBatchDatabase {
  constructor(private readonly executor: StoreExecutor) {}

  prepare(sql: string): BatchStatement {
    return new BatchStatement(this.executor, sql)
  }

  async batch<T = Record<string, unknown>>(statements: BatchStatement[]): Promise<D1Result<T>[]> {
    const results = await this.executor(statements.map((statement) => statement.toStatement()))
    return results.map((result) => toD1Result<T>(result))
  }

  /** Cast to the D1 interface the services are typed against (only the subset above is used). */
  asD1(): D1Database {
    return this as unknown as D1Database
  }
}
