import { OpenAI } from "openai";
import { TypedEmitter } from "tiny-typed-emitter";

import { Context } from "./index.js";

export type ObjectType = "assistant" | "thread" | "message" | "run";
export type Id = string;
interface CacheEvents<T> {
  cacheInserted: (object: ObjectType, id: Id, value: T) => void;
  updated: (object: ObjectType, id: Id, value: T) => void;
  cacheRemoved: (object: ObjectType, id: Id, value: T) => void;
  fetched: (object: ObjectType, id: Id, value: T) => void;
  created: (object: ObjectType, id: Id, value: T) => void;
  deleted: (object: ObjectType, id: Id, value: T) => void;
}
export interface CacheItemEvents<T> {
  cacheInserted: (id: Id, value: T) => void;
  updated: (id: Id, value: T) => void;
  cacheRemoved: (id: Id, value: T) => void;
  fetched: (id: Id, value: T) => void;
  created: (id: Id, value: T) => void;
  deleted: (id: Id, value: T) => void;
}
interface ObjectCacheItem<T> {
  value: T;
  emitter: TypedEmitter<CacheItemEvents<T>>;
}
interface ObjectCache<T> {
  data: Record<Id, ObjectCacheItem<T>>;
  emitter: TypedEmitter<CacheItemEvents<T>>;
}
export class Cache {
  private _emitter = new TypedEmitter<CacheEvents<any>>();

  private _cache: Record<ObjectType, ObjectCache<any>> = {
    assistant: {
      data: {},
      emitter: new TypedEmitter<CacheItemEvents<any>>(),
    },
    thread: {
      data: {},
      emitter: new TypedEmitter<CacheItemEvents<any>>(),
    },
    message: {
      data: {},
      emitter: new TypedEmitter<CacheItemEvents<any>>(),
    },
    run: {
      data: {},
      emitter: new TypedEmitter<CacheItemEvents<any>>(),
    },
  };

  constructor(private ctx: Context) {}

  /**
   * Returns the emitter for the entire cache; emits events for all objects.
   */
  emitter<T = any>(): TypedEmitter<CacheEvents<T>>;
  /**
   * Returns the emitter for a specific object type; emits events for all items of that type.
   * @param object The object type to get the emitter for.
   * @throws If the object type is invalid
   */
  emitter<T = any>(object: ObjectType): TypedEmitter<CacheItemEvents<T>>;
  /**
   * Returns the emitter for a specific object type and id; emits events for that specific item.
   * @param object The object type
   * @param id The id of the object
   * @throws If the object type is invalid or the cache is empty for that id
   */
  emitter<T = any>(
    object: ObjectType,
    id: Id,
  ): TypedEmitter<CacheItemEvents<T>>;
  emitter<T = any>(object?: ObjectType, id?: Id) {
    if (!object) return this._emitter as TypedEmitter<CacheEvents<T>>;

    const cache = this._cache[object];
    if (!cache) throw new Error(`Invalid object type ${object} to get emitter`);

    if (!id) return cache.emitter as TypedEmitter<CacheItemEvents<T>>;

    const item = cache.data[id];
    if (!item)
      throw new Error(`Cannot get emitter when cache is empty for id ${id}`);

    return item.emitter as TypedEmitter<CacheItemEvents<T>>;
  }

  /**
   * Emits an event for an item in the cache, the object type, and the entire cache.
   */
  _emit<T>(event: keyof CacheEvents<T>, object: ObjectType, id: Id, value?: T) {
    this.emitter().emit(event, object, id, value);
    this.emitter(object).emit(event, id, value);
    this.emitter(object, id).emit(event, id, value);
  }

  /**
   * Fetches an object from the API and caches it.
   * First emits either 'cacheInserted' or 'updated' events, then emits a 'fetched' event.
   * @param object ObjectType to fetch
   * @param id Id of the object to fetch. For 'message' and 'run' objects, this is an object with a threadId and id property.
   * @param options OpenAI.OpenAI.RequestOptions to pass to the fetch
   * @throws If the object type is invalid
   * @returns The fetched object
   */
  async fetch<T>(
    object: ObjectType,
    id: Id | { threadId: Id; id: Id },
    options: OpenAI.RequestOptions = {},
  ): Promise<T> {
    let result: T;
    const opts = this.ctx._opts(options);
    switch (object) {
      case "assistant":
        if (typeof id !== "string")
          throw new Error(`Invalid id type ${typeof id} to fetch an ${object}`);
        result = (await this.ctx.client.beta.assistants.retrieve(
          id,
          opts,
        )) as T;
        break;
      case "thread":
        if (typeof id !== "string")
          throw new Error(`Invalid id type ${typeof id} to fetch an ${object}`);
        result = (await this.ctx.client.beta.threads.retrieve(id, opts)) as T;
        break;
      case "message":
        if (typeof id !== "object")
          throw new Error(`Invalid id type ${typeof id} to fetch an ${object}`);
        result = (await this.ctx.client.beta.threads.messages.retrieve(
          id.threadId,
          id.id,
          opts,
        )) as T;
        break;
      case "run":
        if (typeof id !== "object")
          throw new Error(`Invalid id type ${typeof id} to fetch an ${object}`);
        result = (await this.ctx.client.beta.threads.runs.retrieve(
          id.threadId,
          id.id,
          opts,
        )) as T;
        break;
      default:
        throw new Error(`Invalid object type ${object} to fetch`);
    }
    const stringId: string = typeof id === "object" ? (id as any).id : id;
    this.set(object, stringId, result);
    this._emit("fetched", object, stringId, result);
    return result;
  }

  /**
   * Returns an object from the cache, or fetches it from the API if it's not in the cache, emitting events in the process.
   * @param object Object type
   * @param id Object id
   * @throws If the object type is invalid
   */
  async getOrFetch<T = any>(
    object: ObjectType,
    id: Id,
    options?: OpenAI.RequestOptions,
  ): Promise<T> {
    const cache = this._cache[object] as ObjectCache<T>;
    if (!cache) throw new Error(`Invalid object type ${object} to getOrFetch`);
    const existing = cache.data[id];
    if (existing) return existing.value;
    return await this.fetch<T>(object, id, options);
  }

  /**
   * Gets an object from the cache
   * @param object Object type
   * @param id Object id
   * @throws If the object type is invalid
   * @returns The object or undefined if it's not in the cache
   */
  get<T = any>(object: ObjectType, id: Id) {
    const cache = this._cache[object] as ObjectCache<T>;
    if (!cache) throw new Error(`Invalid object type ${object} to get`);
    return (this._cache[object] as ObjectCache<T>).data[id]?.value;
  }

  /**
   * Sets an object in the cache. If it already exists, emits an 'updated' event, otherwise emits an 'cacheInserted' event.
   * @param object Object type
   * @param id Object id
   * @param value Value to insert
   * @throws If the object type is invalid
   */
  set<T>(object: ObjectType, id: Id, value: T) {
    const cache = this._cache[object] as ObjectCache<T>;
    if (!cache) throw new Error(`Invalid object type ${object} to set`);
    if (cache.data[id]) {
      const data = cache.data[id]!;
      if (data.value === value) return;
      data.value = value;
      this._emit("updated", object, id, value);
    } else {
      cache.data[id] = {
        value,
        emitter: new TypedEmitter<CacheItemEvents<T>>(),
      };
      this._emit("cacheInserted", object, id, value);
    }
  }

  /** Removes an item from the cache. Emits a 'cacheRemoved' event. */
  remove<T>(object: ObjectType, id: Id) {
    const cache = this._cache[object] as ObjectCache<T>;
    if (!cache) throw new Error(`Invalid object type ${object} to remove`);
    if (cache.data[id]) {
      const data = cache.data[id]!;
      this._emit("cacheRemoved", object, id);
      data.emitter.removeAllListeners();
      delete cache.data[id];
    }
  }
}
