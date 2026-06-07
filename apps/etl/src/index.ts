import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { runRefreshSlice } from '@sigma/ingest';
import refreshSliceSql from '../../../scripts/refresh-slice.sql';
import { computeWorkerCatchupPlan, ingestOcdsWindow, type CatchupPlan } from './eop';

export interface Env {
  DB: D1Database;
  REFRESH: Workflow;
  EOP_OPEN_DATA_BASE_URL?: string;
}

interface RefreshParams {
  /** Operator override for tests/manual runs. Normal cron uses UTC today. */
  today?: string;
  /** Small overlap to re-read already loaded bucket days; default is 3. */
  lookbackDays?: number;
  /** Safety cap for Worker steady-state runs; large gaps belong to the CLI catch-up. */
  maxWindowDays?: number;
}

interface RefreshResult {
  from: string;
  to: string;
  maxLoadedDate: string | null;
  gapDays: number;
  capped: boolean;
  days: number;
  staged: number;
  derived: number;
}

function stagedRows(results: Awaited<ReturnType<typeof ingestOcdsWindow>>): number {
  return results.reduce(
    (n, r) => n + r.contracts + r.amendments + r.parties + r.awardSuppliers + r.lots,
    0,
  );
}

// The on-platform daily refresh reads storage.eop.bg buckets directly. It is intentionally a small
// steady-state job: if D1 is many days behind, the Workflow caps to a recent window and logs a
// warning; the large first-run/backfill catch-up is the CLI's job to avoid D1/CPU/subrequest limits.
// Current Worker scope stages the in-bucket OCDS enrichment only. Plain base JSON staging remains on
// the CLI until the load-eop coercion map is extracted into shared Worker-safe helpers.
export class RefreshWorkflow extends WorkflowEntrypoint<Env, RefreshParams> {
  override async run(
    event: WorkflowEvent<RefreshParams>,
    step: WorkflowStep,
  ): Promise<RefreshResult> {
    const params = event.payload ?? {};
    const fetchedAt = new Date().toISOString();

    const plan = await step.do('plan-catchup', async () =>
      computeWorkerCatchupPlan(this.env.DB, {
        today: params.today,
        lookbackDays: params.lookbackDays,
        maxWindowDays: params.maxWindowDays,
      }),
    );

    if ((plan as CatchupPlan).capped) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'etl_window_capped',
          maxLoadedDate: plan.maxLoadedDate,
          originalFrom: plan.originalFrom,
          originalGapDays: plan.originalGapDays,
          from: plan.from,
          to: plan.to,
          gapDays: plan.gapDays,
        }),
      );
    }

    const results = await step.do('ingest-storage-eop-ocds', async () =>
      ingestOcdsWindow(this.env.DB, plan, {
        baseUrl: this.env.EOP_OPEN_DATA_BASE_URL,
        fetchedAt,
      }),
    );
    const staged = stagedRows(results);

    if (staged === 0) {
      console.warn(JSON.stringify({ level: 'warn', event: 'etl_zero_ingest', fetchedAt, plan }));
      return { ...plan, days: results.length, staged: 0, derived: 0 };
    }

    const derived = await step.do('derive-slice', async () =>
      runRefreshSlice(this.env.DB, refreshSliceSql),
    );

    return { ...plan, days: results.length, staged, derived };
  }
}

export default {
  // Cron entrypoint: kick one durable refresh run. No public route or HTTP trigger is configured.
  async scheduled(_controller, env): Promise<void> {
    const instance = await env.REFRESH.create();
    console.log(JSON.stringify({ level: 'info', event: 'etl_scheduled_refresh', id: instance.id }));
  },
} satisfies ExportedHandler<Env>;
