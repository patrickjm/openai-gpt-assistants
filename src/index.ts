import OpenAI from 'openai';
import { Cache } from './cache.js';

export * from './assistant.js';

type GlobalRequestOptions = Exclude<OpenAI.RequestOptions, 'method'|'body'|'query'|'path'>;



export class Context {
  cache: Cache;
  constructor(public readonly client: OpenAI, public requestOptions: GlobalRequestOptions = {}) {
    this.cache = new Cache(this);
  }

  _opts(options: OpenAI.RequestOptions): OpenAI.RequestOptions {
    return {
      ...this.requestOptions,
      ...options
    };
  }
}