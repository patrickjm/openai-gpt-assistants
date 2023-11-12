import { OpenAI } from "openai";

import { Assistant, Context } from "./index.js";
import { Run } from "./run.js";
import { Thread } from "./thread.js";
import { createWrappedPage, StatefulObject } from "./utils.js";

export interface MessageEvents {}

export class Message extends StatefulObject<
  Message,
  OpenAI.Beta.Threads.Messages.ThreadMessage,
  MessageEvents
> {
  constructor(
    ctx: Context,
    public thread: Thread,
    id: string,
  ) {
    super(ctx, Message.object, id);
  }

  static readonly object = "message";
  readonly object = Message.object;

  get createdAt() {
    return new Date(this.wrappedValue.created_at * 1000);
  }
  get content() {
    return this.wrappedValue.content;
  }
  get assistant() {
    return this.wrappedValue.assistant_id
      ? new Assistant(this._ctx, this.wrappedValue.assistant_id)
      : null;
  }
  get fileIds() {
    return this.wrappedValue.file_ids;
  }
  get metadata() {
    return this.wrappedValue.metadata;
  }
  get role() {
    return this.wrappedValue.role;
  }
  get run() {
    return this.wrappedValue.run_id
      ? new Run(this._ctx, this.thread, this.wrappedValue.run_id)
      : null;
  }

  /** Creates a message */
  static async create(
    ctx: Context,
    thread: Thread,
    params: OpenAI.Beta.Threads.MessageCreateParams,
    options: OpenAI.RequestOptions = {},
  ) {
    const message = await ctx.client.beta.threads.messages.create(
      thread.id,
      params,
      options,
    );
    ctx.cache.set(this.object, message.id, message);
    ctx.cache._emit("created", this.object, message.id, message);
    const created = new Message(ctx, thread, message.id);
    return created;
  }

  /** Constructs a new Message object by fetching by id or returning from cache if already present. */
  static async load(
    ctx: Context,
    thread: Thread,
    id: string,
    options?: OpenAI.RequestOptions,
  ) {
    const message = new Message(ctx, thread, id);
    await message.load(options);
    return message;
  }

  /** Modifies a message */
  async update(
    params: OpenAI.Beta.Threads.MessageUpdateParams,
    options: OpenAI.RequestOptions = {},
  ) {
    const result = await this._ctx.client.beta.threads.messages.update(
      this.thread.id,
      this.id,
      params,
      options,
    );
    this._cache.set(this.object, this.id, result);
    return this;
  }

  /**
   * Returns a list of messages from a thread.
   */
  static async list(
    ctx: Context,
    thread: Thread,
    options: OpenAI.RequestOptions = {},
  ) {
    const page = await ctx.client.beta.threads.messages.list(
      thread.id,
      ctx._opts(options),
    );
    return createWrappedPage(
      ctx,
      page,
      (ctx, id) => new Message(ctx, thread, id),
    );
  }

  /**
   * Returns a list of files from a message. Files aren't cached.
   */
  async listFiles(
    query?: OpenAI.Beta.Threads.Messages.Files.FileListParams,
    options: OpenAI.RequestOptions = {},
  ) {
    const page = await this._ctx.client.beta.threads.messages.files.list(
      this.thread.id,
      this.id,
      query,
      this._ctx._opts(options),
    );
    return page;
  }

  /**
   * Gets a file by id. Files aren't cached.
   */
  async fetchFile(id: string, options: OpenAI.RequestOptions = {}) {
    const file = await this._ctx.client.beta.threads.messages.files.retrieve(
      this.thread.id,
      this.id,
      id,
      this._ctx._opts(options),
    );
    return file;
  }
}
