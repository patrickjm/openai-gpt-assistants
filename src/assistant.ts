import OpenAI from 'openai';
import { Context } from './index.js';
import { StatefulObject, createWrappedPage } from './utils.js';

export interface AssistantEvents {
}

export class Assistant extends StatefulObject<Assistant, OpenAI.Beta.Assistant, AssistantEvents> {
  constructor(ctx: Context, id: string) {
    super(ctx, Assistant.object, id);
  }
  
  static readonly object = 'assistant';
  readonly object = Assistant.object;
  get name() { return this.wrappedValue.name; }
  get description() { return this.wrappedValue.description; }
  get instructions() { return this.wrappedValue.instructions; }
  get model() { return this.wrappedValue.model; }
  get fileIds() { return this.wrappedValue.file_ids; }
  get createdAt() { return new Date(this.wrappedValue.created_at * 1000); }
  get metadata() { return this.wrappedValue.metadata; }
  get tools() { return this.wrappedValue.tools; }

  /** 
   * Create an assistant with a model and instructions.
   */
  static async create(ctx: Context, params: OpenAI.Beta.AssistantCreateParams, options: OpenAI.RequestOptions = {}) {
    const assistant = await ctx.client.beta.assistants.create(params, ctx._opts(options));
    ctx.cache.set(this.object, assistant.id, assistant);
    ctx.cache._emit('created', this.object, assistant.id, assistant);
    const created = new Assistant(ctx, assistant.id);
    return created;
  }

  /** 
   * Deletes this assistant.
   */
  async delete(options: OpenAI.RequestOptions = {}) {
    const deleted = await this._ctx.client.beta.assistants.del(this.wrappedValue.id, this._ctx._opts(options));
    if (deleted.deleted) {
      this._cache._emit('deleted', this.object, this.wrappedValue.id);
      this._cache.remove(this.object, this.wrappedValue.id);
    }
    return deleted;
  }

  /** 
   * Returns a list of assistants.
   */
  static async list(ctx: Context, options: OpenAI.RequestOptions = {}) {
    const page = await ctx.client.beta.assistants.list(ctx._opts(options));
    const wrapped = createWrappedPage(ctx, page, (ctx, id) => new Assistant(ctx, id));
    return wrapped;
  }

  /** 
   * Modifies this assistant.
   */
  async update(params: OpenAI.Beta.AssistantUpdateParams, options: OpenAI.RequestOptions = {}) {
    const assistant = await this._ctx.client.beta.assistants.update(this.wrappedValue.id, params, this._ctx._opts(options));
    this._cache.set(this.object, assistant.id, assistant);
    return this;
  }
}