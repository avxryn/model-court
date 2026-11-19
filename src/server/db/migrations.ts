/**
 * Append-only D1 migrations (spec §5.2, §5.4–5.6).
 *
 * Each migration is an explicit list of statements executed one at a time with
 * `prepare().run()`. The SDK's `runMigrations` splits strings on `;`, which
 * would break trigger bodies (verified Nov 16, 2026), so Model Court keeps its
 * own ledger table. NEVER edit or reorder an applied migration; append a new one.
 */

export interface Migration {
  id: string
  statements: string[]
}

const immutable = (table: string, columns: string, when = '1') => `
CREATE TRIGGER ${table}_${columns.replace(/[^a-z]+/g, '_')}_immutable
BEFORE UPDATE OF ${columns} ON ${table}
FOR EACH ROW WHEN ${when}
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_${table.toUpperCase()}'); END`

export const MIGRATIONS: Migration[] = [
  {
    id: '0001_initial',
    statements: [
      `CREATE TABLE evaluations (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        task_description TEXT NOT NULL,
        draft_json TEXT NOT NULL CHECK (json_valid(draft_json)),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
      `CREATE INDEX evaluations_by_owner ON evaluations(owner_user_id, updated_at, id)`,

      `CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
        owner_user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('generating','ready','reviewing','revealed','decided','canceled')),
        snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
        snapshot_hash TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        eligible_manifest_json TEXT CHECK (eligible_manifest_json IS NULL OR json_valid(eligible_manifest_json)),
        review_opened_at INTEGER,
        revealed_at INTEGER,
        reveal_cohort_json TEXT CHECK (reveal_cohort_json IS NULL OR json_valid(reveal_cohort_json)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        canceled_at INTEGER
      )`,
      `CREATE UNIQUE INDEX one_active_run_per_evaluation ON runs(evaluation_id) WHERE status IN ('generating','ready','reviewing')`,
      `CREATE INDEX runs_by_evaluation ON runs(evaluation_id, created_at, id)`,
      `CREATE INDEX runs_by_status ON runs(status, updated_at)`,
      immutable('runs', 'snapshot_json, snapshot_hash, owner_user_id, evaluation_id',
        'NEW.snapshot_json IS NOT OLD.snapshot_json OR NEW.snapshot_hash IS NOT OLD.snapshot_hash OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.evaluation_id IS NOT OLD.evaluation_id'),
      immutable('runs', 'eligible_manifest_json', 'OLD.eligible_manifest_json IS NOT NULL AND NEW.eligible_manifest_json IS NOT OLD.eligible_manifest_json'),
      immutable('runs', 'reveal_cohort_json', 'OLD.reveal_cohort_json IS NOT NULL AND NEW.reveal_cohort_json IS NOT OLD.reveal_cohort_json'),

      `CREATE TABLE generations (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        case_key TEXT NOT NULL,
        configuration_key TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic')),
        status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','uncertain','canceled')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2),
        accepted_attempt_id TEXT,
        last_error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (run_id, case_key, configuration_key)
      )`,
      `CREATE INDEX generations_by_run_status ON generations(run_id, status)`,
      immutable('generations', 'accepted_attempt_id', 'OLD.accepted_attempt_id IS NOT NULL AND NEW.accepted_attempt_id IS NOT OLD.accepted_attempt_id'),

      `CREATE TABLE generation_attempts (
        id TEXT PRIMARY KEY,
        generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 2),
        fence_token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','uncertain','canceled')),
        started_at INTEGER NOT NULL,
        deadline_at INTEGER NOT NULL,
        finished_at INTEGER,
        queue_wait_ms INTEGER CHECK (queue_wait_ms IS NULL OR queue_wait_ms >= 0),
        output_text TEXT,
        finish_reason TEXT,
        input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
        output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
        duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        error_code TEXT,
        provider_request_id TEXT,
        observed_model TEXT,
        truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
        UNIQUE (generation_id, attempt_no)
      )`,
      `CREATE INDEX attempts_by_status_deadline ON generation_attempts(status, deadline_at)`,
      immutable('generation_attempts', 'output_text, status, finish_reason', "OLD.status <> 'running'"),

      `CREATE TABLE review_sessions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        reviewer_user_id TEXT NOT NULL,
        context_type TEXT NOT NULL CHECK (context_type IN ('invited','owner')),
        status TEXT NOT NULL CHECK (status IN ('draft','submitted','closed','revoked')),
        assignment_json TEXT NOT NULL CHECK (json_valid(assignment_json)),
        ratings_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(ratings_json)),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        joined_at INTEGER NOT NULL,
        submitted_at INTEGER,
        closed_at INTEGER,
        identity_clue_flag INTEGER NOT NULL DEFAULT 0 CHECK (identity_clue_flag IN (0,1)),
        UNIQUE (run_id, reviewer_user_id)
      )`,
      `CREATE INDEX review_sessions_by_run_status ON review_sessions(run_id, status)`,
      `CREATE INDEX review_sessions_by_reviewer ON review_sessions(reviewer_user_id, status, run_id)`,
      immutable('review_sessions', 'assignment_json', 'NEW.assignment_json IS NOT OLD.assignment_json'),
      immutable('review_sessions', 'ratings_json, identity_clue_flag', "OLD.status <> 'draft'"),

      `CREATE TABLE invites (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        redeemed_by TEXT,
        redeemed_at INTEGER,
        revoked_at INTEGER
      )`,
      `CREATE INDEX invites_by_run ON invites(run_id, expires_at)`,

      `CREATE TABLE verdict_revisions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        outcome TEXT NOT NULL CHECK (outcome IN ('selected','tie','inconclusive')),
        selected_configuration_key TEXT,
        rationale TEXT NOT NULL,
        limitations TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (run_id, revision),
        CHECK ((outcome = 'selected') = (selected_configuration_key IS NOT NULL))
      )`,
      `CREATE TRIGGER verdict_revisions_append_only BEFORE UPDATE ON verdict_revisions
       BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERDICT_REVISIONS'); END`,

      `CREATE TABLE command_receipts (
        actor_user_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        entity_id TEXT,
        http_status INTEGER NOT NULL,
        response_json TEXT NOT NULL CHECK (json_valid(response_json)),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (actor_user_id, idempotency_key)
      )`,
      `CREATE INDEX command_receipts_by_expiry ON command_receipts(expires_at)`,

      // Guarded-transaction sentinel (spec §5.4): the first statement of a guarded
      // batch inserts ok = CASE WHEN <preconditions> THEN 1 ELSE 0 END; the CHECK
      // aborts the whole batch when any precondition fails. The last statement deletes it.
      `CREATE TABLE command_guards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ok INTEGER NOT NULL CHECK (ok = 1)
      )`,

      `CREATE TABLE outbox (
        id TEXT PRIMARY KEY,
        generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 2),
        status TEXT NOT NULL CHECK (status IN ('pending','dispatched','claimed','terminal')),
        job_id TEXT,
        dispatch_count INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_count >= 0),
        next_dispatch_at INTEGER NOT NULL,
        last_error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (generation_id, attempt_no)
      )`,
      `CREATE INDEX outbox_by_status ON outbox(status, next_dispatch_at)`,

      `CREATE TABLE budget_buckets (
        subject TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        limit_units INTEGER NOT NULL CHECK (limit_units >= 0),
        allocated_units INTEGER NOT NULL DEFAULT 0 CHECK (allocated_units >= 0 AND allocated_units <= limit_units),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (subject, window_start)
      )`,

      `CREATE TABLE attempt_reservations (
        generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 2),
        actor_subject TEXT NOT NULL,
        global_subject TEXT NOT NULL,
        lifetime_subject TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('reserved','consumed','released')),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (generation_id, attempt_no)
      )`,

      `CREATE TABLE rate_buckets (
        subject TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (subject, window_start)
      )`,

      `CREATE TABLE provider_credentials (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic')),
        label TEXT NOT NULL,
        ciphertext TEXT,
        nonce TEXT,
        encryption_key_version TEXT,
        status TEXT NOT NULL CHECK (status IN ('active','revoked')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at INTEGER NOT NULL,
        revoked_at INTEGER,
        CHECK (
          (status = 'active' AND ciphertext IS NOT NULL AND nonce IS NOT NULL AND encryption_key_version IS NOT NULL AND revoked_at IS NULL)
          OR (status = 'revoked' AND ciphertext IS NULL AND nonce IS NULL AND encryption_key_version IS NULL AND revoked_at IS NOT NULL)
        )
      )`,
      `CREATE UNIQUE INDEX one_active_credential_per_provider ON provider_credentials(owner_user_id, provider) WHERE status = 'active'`,
      // Revocation is one-way: a revoked row can never be reactivated (restore safety, §9.6).
      immutable('provider_credentials', 'status', "OLD.status = 'revoked'"),
      immutable('provider_credentials', 'owner_user_id, provider', 'NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.provider IS NOT OLD.provider'),

      `CREATE TABLE run_credentials (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic')),
        credential_id TEXT NOT NULL REFERENCES provider_credentials(id) ON DELETE RESTRICT,
        PRIMARY KEY (run_id, provider)
      )`,
      `CREATE TRIGGER run_credentials_immutable BEFORE UPDATE ON run_credentials
       BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RUN_CREDENTIALS'); END`,

      `CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT,
        run_id TEXT,
        actor_user_id TEXT,
        event_type TEXT NOT NULL,
        request_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX audit_events_by_evaluation ON audit_events(evaluation_id, created_at)`,
      `CREATE INDEX audit_events_by_created ON audit_events(created_at)`,
    ],
  },
  {
    // D-23: keys expire unless renewed; last use is visible to the owner.
    id: '0002_credential_expiry_and_last_use',
    statements: [
      `ALTER TABLE provider_credentials ADD COLUMN expires_at INTEGER`,
      `ALTER TABLE provider_credentials ADD COLUMN last_used_at INTEGER`,
      `ALTER TABLE provider_credentials ADD COLUMN last_used_run_id TEXT`,
      // Keys saved before this migration get the default 7-day lifetime from creation.
      `UPDATE provider_credentials SET expires_at = created_at + 604800000 WHERE status = 'active' AND expires_at IS NULL`,
      `CREATE INDEX provider_credentials_by_expiry ON provider_credentials(status, expires_at)`,
    ],
  },
  {
    // D-38: imported evidence. Draft-side answers are editable; hearing-side copies are immutable.
    id: '0003_imported_evidence',
    statements: [
      `CREATE TABLE evaluation_imports (
        evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
        configuration_key TEXT NOT NULL,
        case_key TEXT NOT NULL,
        text TEXT NOT NULL,
        text_sha256 TEXT NOT NULL,
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (evaluation_id, configuration_key, case_key)
      )`,
      `CREATE TABLE run_imported_outputs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        configuration_key TEXT NOT NULL,
        case_key TEXT NOT NULL,
        text TEXT NOT NULL,
        text_sha256 TEXT NOT NULL,
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        created_at INTEGER NOT NULL,
        UNIQUE (run_id, configuration_key, case_key)
      )`,
      `CREATE TRIGGER run_imported_outputs_immutable BEFORE UPDATE ON run_imported_outputs
       BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_IMPORTED_OUTPUTS'); END`,
    ],
  },
  {
    // D-40: the special master (advisory AI grader). Separate from hearings so its
    // scores can never enter the jury's findings; mirrors the paid-call tables.
    id: '0004_special_master',
    statements: [
      `CREATE TABLE grader_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        owner_user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('generating','ready','canceled')),
        config_json TEXT NOT NULL CHECK (json_valid(config_json)),
        config_hash TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX grader_runs_one_active ON grader_runs(run_id) WHERE status = 'generating'`,
      immutable('grader_runs', 'config_json, config_hash'),
      `CREATE TABLE grader_credentials (
        grader_run_id TEXT NOT NULL REFERENCES grader_runs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic')),
        credential_id TEXT NOT NULL,
        PRIMARY KEY (grader_run_id, provider)
      )`,
      `CREATE TRIGGER grader_credentials_immutable BEFORE UPDATE ON grader_credentials
       BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_GRADER_CREDENTIALS'); END`,
      `CREATE TABLE grader_items (
        id TEXT PRIMARY KEY,
        grader_run_id TEXT NOT NULL REFERENCES grader_runs(id) ON DELETE CASCADE,
        case_key TEXT NOT NULL,
        configuration_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','uncertain','canceled')),
        attempt_count INTEGER NOT NULL DEFAULT 1,
        accepted_attempt_id TEXT,
        last_error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (grader_run_id, case_key, configuration_key)
      )`,
      `CREATE TABLE grader_attempts (
        id TEXT PRIMARY KEY,
        grader_item_id TEXT NOT NULL REFERENCES grader_items(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 2),
        fence_token TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','uncertain')),
        started_at INTEGER NOT NULL,
        deadline_at INTEGER NOT NULL,
        finished_at INTEGER,
        output_text TEXT,
        parsed_json TEXT CHECK (parsed_json IS NULL OR json_valid(parsed_json)),
        error_code TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        duration_ms INTEGER,
        provider_request_id TEXT,
        UNIQUE (grader_item_id, attempt_no)
      )`,
      immutable('grader_attempts', 'output_text, parsed_json, status', "OLD.status <> 'running'"),
      `CREATE TABLE grader_outbox (
        id TEXT PRIMARY KEY,
        grader_item_id TEXT NOT NULL REFERENCES grader_items(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','dispatched','claimed','terminal')),
        next_dispatch_at INTEGER NOT NULL,
        dispatch_count INTEGER NOT NULL DEFAULT 0,
        job_id TEXT,
        last_error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (grader_item_id, attempt_no)
      )`,
      `CREATE TABLE grader_reservations (
        grader_item_id TEXT NOT NULL REFERENCES grader_items(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 2),
        actor_subject TEXT NOT NULL,
        global_subject TEXT NOT NULL,
        lifetime_subject TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('reserved','consumed','released')),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (grader_item_id, attempt_no)
      )`,
    ],
  },
  {
    // D-41: accountless jurors. Secrets are stored only as SHA-256 hashes.
    id: '0005_accountless_jurors',
    statements: [
      `CREATE TABLE juror_principals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        invite_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        resume_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      )`,
      `CREATE TABLE juror_devices (
        id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL REFERENCES juror_principals(id) ON DELETE CASCADE,
        secret_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked_at INTEGER
      )`,
      `CREATE INDEX juror_devices_by_principal ON juror_devices(principal_id)`,
    ],
  },
  {
    // D-57: "Check key" (a free list-models call) and re-pinning a hearing to the judge's current key.
    id: '0006_key_checks_and_repin',
    statements: [
      `ALTER TABLE provider_credentials ADD COLUMN last_checked_at INTEGER`,
      `ALTER TABLE provider_credentials ADD COLUMN last_check_result TEXT CHECK (last_check_result IS NULL OR last_check_result IN ('valid','invalid','restricted','unreachable'))`,
      // The pin stays immutable except for one move: an unfinished run's provider slot may point at
      // another active key of the same owner and provider. The service also requires the old key to be
      // removed or expired; the trigger cannot read the request clock, so it enforces the rest.
      `DROP TRIGGER run_credentials_immutable`,
      `CREATE TRIGGER run_credentials_immutable BEFORE UPDATE ON run_credentials
       FOR EACH ROW WHEN NEW.run_id IS NOT OLD.run_id OR NEW.provider IS NOT OLD.provider
         OR NOT EXISTS (SELECT 1 FROM runs r WHERE r.id = NEW.run_id AND r.status IN ('generating','ready'))
         OR NOT EXISTS (
           SELECT 1 FROM provider_credentials c JOIN runs r ON r.id = NEW.run_id
           WHERE c.id = NEW.credential_id AND c.owner_user_id = r.owner_user_id AND c.provider = NEW.provider AND c.status = 'active')
       BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RUN_CREDENTIALS'); END`,
    ],
  },
  {
    // D-64: cached-input and reasoning usage as the providers report them, for cost estimates.
    // Additive; rows before this read null ("not recorded"). The id 0007 is left for roadmap item 2.
    id: '0008_attempt_usage_details',
    statements: [
      `ALTER TABLE generation_attempts ADD COLUMN cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0)`,
      `ALTER TABLE generation_attempts ADD COLUMN reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0)`,
    ],
  },
  {
    // D-65: repeats. `generations` gains `sample_no` and UNIQUE (run_id, case_key, configuration_key, sample_no).
    // SQLite cannot alter a UNIQUE constraint, so the table is rebuilt. Neither D1 nor the Durable
    // Object store lets a migration turn foreign keys off, and with them on, DROP TABLE generations
    // would cascade-delete every attempt, outbox row and reservation. So the parent and its three
    // children are rebuilt together, children dropped first, in this one migration (one transaction).
    // Renaming generations_next to generations rewrites the children's REFERENCES (legacy_alter_table
    // is off on both stores). Columns, checks, indexes and triggers are identical to 0001 + 0008.
    // LIVE TABLE REBUILD: take a V9 backup before deploying (docs/runbook.md); Avery's OK required.
    id: '0009_generation_samples',
    statements: [
      `CREATE TABLE generations_next (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        case_key TEXT NOT NULL,
        configuration_key TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic')),
        status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','uncertain','canceled')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2),
        accepted_attempt_id TEXT,
        last_error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sample_no INTEGER NOT NULL DEFAULT 1 CHECK (sample_no BETWEEN 1 AND 3),
        UNIQUE (run_id, case_key, configuration_key, sample_no)
      )`,
      `INSERT INTO generations_next (id, run_id, case_key, configuration_key, provider, status, attempt_count, accepted_attempt_id, last_error_code, created_at, updated_at, sample_no)
       SELECT id, run_id, case_key, configuration_key, provider, status, attempt_count, accepted_attempt_id, last_error_code, created_at, updated_at, 1 FROM generations ORDER BY rowid`,

      `CREATE TABLE generation_attempts_next (
        id TEXT PRIMARY KEY,
        generation_id TEXT NOT NULL REFERENCES generations_next(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 2),
        fence_token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','uncertain','canceled')),
        started_at INTEGER NOT NULL,
        deadline_at INTEGER NOT NULL,
        finished_at INTEGER,
        queue_wait_ms INTEGER CHECK (queue_wait_ms IS NULL OR queue_wait_ms >= 0),
        output_text TEXT,
        finish_reason TEXT,
        input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
        output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
        duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        error_code TEXT,
        provider_request_id TEXT,
        observed_model TEXT,
        truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
        cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
        reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
        UNIQUE (generation_id, attempt_no)
      )`,
      `INSERT INTO generation_attempts_next (id, generation_id, attempt_no, fence_token, status, started_at, deadline_at, finished_at, queue_wait_ms, output_text, finish_reason, input_tokens, output_tokens, duration_ms, error_code, provider_request_id, observed_model, truncated, cached_input_tokens, reasoning_tokens)
       SELECT id, generation_id, attempt_no, fence_token, status, started_at, deadline_at, finished_at, queue_wait_ms, output_text, finish_reason, input_tokens, output_tokens, duration_ms, error_code, provider_request_id, observed_model, truncated, cached_input_tokens, reasoning_tokens FROM generation_attempts ORDER BY rowid`,

      `CREATE TABLE outbox_next (
        id TEXT PRIMARY KEY,
        generation_id TEXT NOT NULL REFERENCES generations_next(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 2),
        status TEXT NOT NULL CHECK (status IN ('pending','dispatched','claimed','terminal')),
        job_id TEXT,
        dispatch_count INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_count >= 0),
        next_dispatch_at INTEGER NOT NULL,
        last_error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (generation_id, attempt_no)
      )`,
      `INSERT INTO outbox_next (id, generation_id, attempt_no, status, job_id, dispatch_count, next_dispatch_at, last_error_code, created_at, updated_at)
       SELECT id, generation_id, attempt_no, status, job_id, dispatch_count, next_dispatch_at, last_error_code, created_at, updated_at FROM outbox ORDER BY rowid`,

      `CREATE TABLE attempt_reservations_next (
        generation_id TEXT NOT NULL REFERENCES generations_next(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 2),
        actor_subject TEXT NOT NULL,
        global_subject TEXT NOT NULL,
        lifetime_subject TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('reserved','consumed','released')),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (generation_id, attempt_no)
      )`,
      `INSERT INTO attempt_reservations_next (generation_id, attempt_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at)
       SELECT generation_id, attempt_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at FROM attempt_reservations ORDER BY rowid`,

      // Children first, so dropping the old parent cascades into nothing. Their indexes and triggers drop with them.
      `DROP TABLE attempt_reservations`,
      `DROP TABLE outbox`,
      `DROP TABLE generation_attempts`,
      `DROP TABLE generations`,
      `ALTER TABLE generations_next RENAME TO generations`,
      `ALTER TABLE generation_attempts_next RENAME TO generation_attempts`,
      `ALTER TABLE outbox_next RENAME TO outbox`,
      `ALTER TABLE attempt_reservations_next RENAME TO attempt_reservations`,

      `CREATE INDEX generations_by_run_status ON generations(run_id, status)`,
      `CREATE INDEX attempts_by_status_deadline ON generation_attempts(status, deadline_at)`,
      `CREATE INDEX outbox_by_status ON outbox(status, next_dispatch_at)`,
      immutable('generations', 'accepted_attempt_id', 'OLD.accepted_attempt_id IS NOT NULL AND NEW.accepted_attempt_id IS NOT OLD.accepted_attempt_id'),
      immutable('generation_attempts', 'output_text, status, finish_reason', "OLD.status <> 'running'"),
      // A testimony slot never moves to another question, party or sample.
      immutable(
        'generations',
        'run_id, case_key, configuration_key, sample_no',
        'NEW.run_id IS NOT OLD.run_id OR NEW.case_key IS NOT OLD.case_key OR NEW.configuration_key IS NOT OLD.configuration_key OR NEW.sample_no IS NOT OLD.sample_no',
      ),
    ],
  },
  {
    // Spec 02 (D-71): where a case came from (a duplicate, a scenario file, a certified record). Set once at
    // creation, never changed. Additive and nullable, so existing cases read null ("made here"). Named 0010
    // (not the spec's 0007) to sit after item 1's 0008/0009; item 3 takes 0011.
    id: '0010_case_origin',
    statements: [
      `ALTER TABLE evaluations ADD COLUMN origin_kind TEXT CHECK (origin_kind IS NULL OR origin_kind IN ('duplicate','scenario_file','certified_record'))`,
      // Only for duplicates of the same judge's case; never an id taken from a file. No FK: the source may be purged.
      `ALTER TABLE evaluations ADD COLUMN origin_evaluation_id TEXT`,
      `ALTER TABLE evaluations ADD COLUMN origin_run_id TEXT`,
      // Computed by the server from the copied questions, never taken from a file.
      `ALTER TABLE evaluations ADD COLUMN origin_scenario_hash TEXT`,
      immutable(
        'evaluations',
        'origin_kind, origin_evaluation_id, origin_run_id, origin_scenario_hash',
        'NEW.origin_kind IS NOT OLD.origin_kind OR NEW.origin_evaluation_id IS NOT OLD.origin_evaluation_id OR NEW.origin_run_id IS NOT OLD.origin_run_id OR NEW.origin_scenario_hash IS NOT OLD.origin_scenario_hash',
      ),
    ],
  },
  {
    // Spec 03 / D-76: automatic checks per accepted testimony (roadmap item 3). One row per accepted
    // generation attempt or frozen imported answer; append-only. Item 2 uses 0010; ids are names and
    // order is array order, so renumbering at merge only reorders this entry.
    id: '0011_task_kit_checks',
    statements: [
      `CREATE TABLE testimony_checks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        case_key TEXT NOT NULL,
        configuration_key TEXT NOT NULL,
        attempt_id TEXT REFERENCES generation_attempts(id) ON DELETE CASCADE,
        imported_output_id TEXT REFERENCES run_imported_outputs(id) ON DELETE CASCADE,
        kit_version TEXT NOT NULL,
        results_json TEXT NOT NULL CHECK (json_valid(results_json) AND json_type(results_json) = 'array' AND length(results_json) <= 16384),
        created_at INTEGER NOT NULL,
        CHECK ((attempt_id IS NULL) <> (imported_output_id IS NULL)),
        UNIQUE (attempt_id),
        UNIQUE (imported_output_id)
      )`,
      `CREATE INDEX testimony_checks_by_run ON testimony_checks(run_id, case_key, configuration_key)`,
      `CREATE TRIGGER testimony_checks_append_only BEFORE UPDATE ON testimony_checks
       BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_TESTIMONY_CHECKS'); END`,
    ],
  },
  {
    // Spec 04 §4.2 / D-87: documents for extraction questions (roadmap item 4). Content-addressed
    // per owner, stored once as base64 chunks (the adapter binds only strings and numbers), and
    // referenced by draft questions (replaceable) and hearings (immutable). Byte quotas in their
    // own buckets, guarded by a CHECK like budget_buckets. Additive: no existing table changes.
    id: '0012_extraction_documents',
    statements: [
      `CREATE TABLE document_blobs (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        media_type TEXT NOT NULL CHECK (media_type IN ('text/plain','application/pdf')),
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        page_count INTEGER CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 20),
        chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 16),
        created_at INTEGER NOT NULL,
        UNIQUE (owner_user_id, sha256)
      )`,
      `CREATE TRIGGER document_blobs_immutable BEFORE UPDATE ON document_blobs
       BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_DOCUMENT_BLOBS'); END`,
      `CREATE TABLE document_blob_chunks (
        blob_id TEXT NOT NULL REFERENCES document_blobs(id) ON DELETE CASCADE,
        chunk_no INTEGER NOT NULL CHECK (chunk_no >= 0),
        data_base64 TEXT NOT NULL CHECK (length(data_base64) > 0 AND length(data_base64) <= 524288 AND length(data_base64) % 4 = 0),
        PRIMARY KEY (blob_id, chunk_no)
      )`,
      `CREATE TRIGGER document_blob_chunks_immutable BEFORE UPDATE ON document_blob_chunks
       BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_DOCUMENT_BLOBS'); END`,
      `CREATE TABLE evaluation_documents (
        evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
        case_key TEXT NOT NULL,
        blob_id TEXT NOT NULL REFERENCES document_blobs(id),
        delivery TEXT NOT NULL CHECK (delivery IN ('text','pdf_native')),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (evaluation_id, case_key)
      )`,
      `CREATE TABLE run_documents (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        case_key TEXT NOT NULL,
        blob_id TEXT NOT NULL REFERENCES document_blobs(id),
        sha256 TEXT NOT NULL,
        delivery TEXT NOT NULL CHECK (delivery IN ('text','pdf_native')),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, case_key)
      )`,
      `CREATE TRIGGER run_documents_immutable BEFORE UPDATE ON run_documents
       BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RUN_DOCUMENTS'); END`,
      `CREATE TABLE document_storage_buckets (
        scope TEXT PRIMARY KEY,
        used_bytes INTEGER NOT NULL CHECK (used_bytes >= 0),
        limit_bytes INTEGER NOT NULL,
        CHECK (used_bytes <= limit_bytes)
      )`,
      `CREATE INDEX document_blobs_by_owner ON document_blobs(owner_user_id, created_at)`,
      `CREATE INDEX run_documents_by_blob ON run_documents(blob_id)`,
      `CREATE INDEX evaluation_documents_by_blob ON evaluation_documents(blob_id)`,
    ],
  },
]

const LEDGER = `CREATE TABLE IF NOT EXISTS mc_schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`

/**
 * Apply pending migrations in order. Each migration's statements plus its ledger
 * row run as one D1 batch, so a failure leaves that migration entirely unapplied.
 */
export async function migrate(db: D1Database, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  await db.prepare(LEDGER).run()
  const applied = new Set(
    (await db.prepare('SELECT id FROM mc_schema_migrations').all<{ id: string }>()).results.map((row) => row.id),
  )
  const newlyApplied: string[] = []
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue
    await db.batch([
      ...migration.statements.map((sql) => db.prepare(sql)),
      db.prepare('INSERT INTO mc_schema_migrations (id, applied_at) VALUES (?, ?)').bind(migration.id, Date.now()),
    ])
    newlyApplied.push(migration.id)
  }
  return newlyApplied
}

/**
 * Synchronous variant for the ModelCourtStore Durable Object, which applies the
 * same ledgered migrations to its own SQLite storage when it starts.
 */
export function migrateSync(
  exec: (sql: string, ...params: Array<string | number>) => Array<Record<string, unknown>>,
  transaction: (fn: () => void) => void,
  migrations: Migration[] = MIGRATIONS,
): string[] {
  exec(LEDGER)
  const applied = new Set(exec('SELECT id FROM mc_schema_migrations').map((row) => String(row.id)))
  const newlyApplied: string[] = []
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue
    transaction(() => {
      for (const sql of migration.statements) exec(sql)
      exec('INSERT INTO mc_schema_migrations (id, applied_at) VALUES (?, ?)', migration.id, Date.now())
    })
    newlyApplied.push(migration.id)
  }
  return newlyApplied
}

const migrated = new WeakMap<D1Database, Promise<unknown>>()

/**
 * Once per isolate and binding. Safe if two isolates race: the loser's batch
 * fails atomically and the next request sees the ledger row.
 */
export function ensureMigrated(db: D1Database): Promise<unknown> {
  let pending = migrated.get(db)
  if (!pending) {
    pending = migrate(db).catch((error: unknown) => {
      migrated.delete(db)
      throw error
    })
    migrated.set(db, pending)
  }
  return pending
}
