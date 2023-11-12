import { OpenAI } from "openai";

import { Cache } from "./cache.js";
export * from "./assistant.js";
export * from "./cache.js";
export * from "./message.js";
export * from "./run.js";
export * from "./thread.js";

type GlobalRequestOptions = Exclude<
  OpenAI.RequestOptions,
  "method" | "body" | "query" | "path"
>;

export class Context {
  cache: Cache;
  constructor(
    public readonly client: OpenAI,
    public requestOptions: GlobalRequestOptions = {},
  ) {
    this.cache = new Cache(this);
  }

  _opts(options: OpenAI.RequestOptions): OpenAI.RequestOptions {
    const opts = {
      ...this.requestOptions,
      ...options,
    };
    for (const key in opts) {
      const casted = key as keyof typeof opts;
      if (opts[casted] === undefined) {
        delete opts[casted];
      }
    }
    return opts;
  }
}
