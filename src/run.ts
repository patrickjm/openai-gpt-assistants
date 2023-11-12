import { OpenAI } from "openai";

import { Assistant, Context } from "./index.js";
import { Thread } from "./thread.js";
import { createWrappedPage, StatefulObject } from "./utils.js";

const POLL_INTERVAL_MS = 750;
const POLL_TIMEOUT_MS = 1000 * 60 * 2; // 2 minutes

export interface RunEvents {
  statusChanged: (status: RunStatus) => void;
  actionRequired: (
    action: OpenAI.Beta.Threads.Runs.Run["required_action"],
  ) => void;
  finished: (err: unknown, status: RunStatus | null) => void;
}

export type RunStatus = OpenAI.Beta.Threads.Runs.Run["status"];

export class Run extends StatefulObject<
  Run,
  OpenAI.Beta.Threads.Runs.Run,
  RunEvents
> {
  private _pollInterval: ReturnType<typeof setInterval> | null = null;
  private _pollStartTime = 0;

  constructor(
    ctx: Context,
    public thread: Thread,
    id: string,
  ) {
    super(ctx, Run.object, id);
  }

  static readonly object = "run";
  readonly object = Run.object;

  /** Retrieves from cache or fetches if missing, then begins polling. */
  async load(options?: OpenAI.RequestOptions) {
    await super.load(options);
    this.beginPolling();
  }

  /** Creates a Run and begins a polling process to check its status. */
  static async create(
    ctx: Context,
    thread: Thread,
    params: RunCreateParams,
    options: OpenAI.RequestOptions = {},
  ) {
    const { assistant, ...rest } = params;
    const runParams = { ...rest, assistant_id: assistant.id };

    const run = await ctx.client.beta.threads.runs.create(
      thread.id,
      runParams,
      options,
    );
    ctx.cache.set(this.object, run.id, run);
    ctx.cache._emit("created", this.object, run.id, run);
    const created = new Run(ctx, thread, run.id);
    created.beginPolling();
    return created;
  }

  /** Constructs a new Run object by fetching by id or returning from cache if already present. */
  static async load(
    ctx: Context,
    thread: Thread,
    id: string,
    options?: OpenAI.RequestOptions,
  ) {
    const run = new Run(ctx, thread, id);
    await run.load(options);
    return run;
  }

  /**
   * Returns a list of Runs from a Thread.
   */
  static async list(
    ctx: Context,
    thread: Thread,
    options: OpenAI.RequestOptions = {},
  ) {
    const page = await ctx.client.beta.threads.runs.list(
      thread.id,
      ctx._opts(options),
    );
    return createWrappedPage(ctx, page, (ctx, id) => new Run(ctx, thread, id));
  }

  /** Modifies this Run */
  async update(
    params: OpenAI.Beta.Threads.RunUpdateParams,
    options: OpenAI.RequestOptions = {},
  ) {
    const result = await this._ctx.client.beta.threads.runs.update(
      this.thread.id,
      this.id,
      params,
      options,
    );
    this._cache.set(this.object, this.id, result);
    return this;
  }

  /** Cancels this Run */
  async cancel(options: OpenAI.RequestOptions = {}) {
    const result = await this._ctx.client.beta.threads.runs.cancel(
      this.thread.id,
      this.id,
      options,
    );
    this._cache.set(this.object, this.id, result);
    return this;
  }

  /**
   * Submits tool outputs to this Run.
   */
  async submitToolOutputs(
    params: OpenAI.Beta.Threads.RunSubmitToolOutputsParams,
    options: OpenAI.RequestOptions = {},
  ) {
    const result = await this._ctx.client.beta.threads.runs.submitToolOutputs(
      this.thread.id,
      this.id,
      params,
      options,
    );
    this._cache.set(this.object, this.id, result);
    return this;
  }

  /**
   * Returns a list of steps from this Run. Steps aren't cached.
   */
  async listSteps(options: OpenAI.RequestOptions = {}) {
    const page = await this._ctx.client.beta.threads.runs.steps.list(
      this.thread.id,
      this.id,
      options,
    );
    return page;
  }

  /**
   * Gets a step by id. Steps aren't cached.
   */
  async fetchStep(id: string, options: OpenAI.RequestOptions = {}) {
    const step = await this._ctx.client.beta.threads.runs.steps.retrieve(
      this.thread.id,
      this.id,
      id,
      options,
    );
    return step;
  }

  /**
   * Waits until this emitter emits a finished event, then returns the status.
   */
  async waitUntilFinished() {
    if (this._pollInterval === null) {
      this.beginPolling();
    }
    return new Promise<RunStatus>((resolve, reject) => {
      this.once("finished", (err, status) => {
        if (err) reject(err);
        else resolve(status!);
      });
    });
  }

  /**
   * Polls the Run until it has finished. Emits events when the status changes.
   *
   * Note - for requires_action status, the actionRequired event will be emitted, then you can call submitToolOutputs()
   */
  beginPolling(options: OpenAI.RequestOptions = {}) {
    // Clear existing polling interval if it exists
    this.endPolling();

    // Start timer
    this._pollStartTime = Date.now();
    // Begin polling interval
    this._pollInterval = setInterval(async () => {
      // Check if polling has timed out and exit if so
      const elapsed = Date.now() - this._pollStartTime;
      if (elapsed > POLL_TIMEOUT_MS) {
        this.endPolling();
        this.emit(
          "finished",
          new Error(
            `Polling for Run id ${this.id} timed out after ${
              POLL_TIMEOUT_MS / 1000
            } seconds`,
          ),
          null,
        );
        return;
      }

      // Fetch the run and emit events if the status has changed
      const oldRun = this.wrappedValue;
      let run: OpenAI.Beta.Threads.Runs.Run;
      try {
        run = await this._ctx.cache.fetch<OpenAI.Beta.Threads.Runs.Run>(
          Run.object,
          { id: this.id, threadId: this.thread.id },
          options,
        );
      } catch (err) {
        console.error(`Error fetching Run id ${this.id} during polling:`, err);
        this.emit("finished", err, null);
        this.endPolling();
        return;
      }
      if (run.status !== oldRun.status) this.emit("statusChanged", run.status);

      // Emit actionRequired event if the run requires action
      if (run.status === "requires_action") {
        this.emit("actionRequired", run.required_action);
      }

      // Emit finished event if the run has finished and end polling
      const exitStatuses: RunStatus[] = [
        "cancelled",
        "expired",
        "completed",
        "failed",
      ];
      if (exitStatuses.includes(run.status)) {
        this.endPolling();
        await this.thread.fetch();
        this.emit("finished", null, run.status);
        return;
      }
    }, POLL_INTERVAL_MS);
  }

  endPolling() {
    clearInterval(this._pollInterval!);
    this._pollInterval = null;
    this._pollStartTime = 0;
  }
}

export interface RunCreateParams
  extends Omit<OpenAI.Beta.Threads.RunCreateParams, "assistant_id"> {
  assistant: Assistant;
}
