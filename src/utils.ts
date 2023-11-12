import { OpenAI } from "openai";
import { CursorPage, CursorPageParams } from "openai/pagination.mjs";
import {
  DefaultListener,
  ListenerSignature,
  TypedEmitter,
} from "tiny-typed-emitter";

import { CacheItemEvents, ObjectType } from "./cache.js";
import { Context } from "./index.js";

export interface StatefulObjectEvents<T> {
  cacheInserted: (value: T) => void;
  updated: (value: T) => void;
  cacheRemoved: (value: T) => void;
  fetched: (value: T) => void;
  created: (value: T) => void;
  deleted: (value: T) => void;
}

export class StatefulObject<
  Self extends StatefulObject<any, Wrapped, Events>,
  Wrapped = any,
  Events extends ListenerSignature<Events> = DefaultListener,
> extends TypedEmitter<Events & StatefulObjectEvents<Self>> {
  private _unsubscribe = () => {};

  constructor(
    protected _ctx: Context,
    public readonly object: ObjectType,
    private readonly _id: string,
  ) {
    super();
    this._subscribe();
  }

  public get wrappedValue(): Wrapped {
    const val = this._ctx.cache.get<Wrapped>(this.object, this._id);
    if (!val) {
      throw new Error(
        "Attempted to access wrapped value of a stateful object that has not been loaded. " +
          "Do you need to call load()? Was the ID invalid?",
      );
    }
    return val;
  }
  protected get _cache() {
    return this._ctx.cache;
  }
  public get id() {
    return this._id;
  }

  /**
   * Fetches the object into the cache. Does not overwrite the value in the cache if already exists.
   */
  public async load(options?: OpenAI.RequestOptions) {
    await this._ctx.cache.getOrFetch(this.object, this._id, options);
    this._subscribe();
  }

  /**
   * Fetches the object into the cache. Overwrites the value in the cache if already exists.
   */
  public async fetch(options?: OpenAI.RequestOptions) {
    await this._ctx.cache.fetch(this.object, this._id, options);
  }

  /** Re-emit events from the cache that pertain to this object */
  private _subscribe() {
    const listeners: Partial<CacheItemEvents<any>> = {};

    const createListener = (key: keyof CacheItemEvents<any>) => {
      listeners[key] = (id: string) => {
        if (id === this._id) {
          this.emit(key, ...([this] as any));
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return listeners[key] as any;
    };

    // cache.emitter throws error if cache is empty for this id
    // TODO: Automatically subscribe to object-type-level or item-level events and switch between upon insert/remove?
    if (!this._ctx.cache.get(this.object, this.id)) {
      return;
    }

    this._unsubscribe();

    const emitter = this._ctx.cache.emitter(this.object, this.id);
    emitter.addListener("cacheInserted", createListener("cacheInserted"));
    emitter.addListener("cacheRemoved", createListener("cacheRemoved"));
    emitter.addListener("updated", createListener("updated"));
    emitter.addListener("fetched", createListener("fetched"));
    emitter.addListener("created", createListener("created"));
    emitter.addListener("deleted", createListener("deleted"));

    this._unsubscribe = () => {
      for (const key in listeners) {
        emitter.removeListener(
          key as any,
          listeners[key as keyof typeof listeners],
        );
      }
      this._unsubscribe = () => {};
    };
  }

  toString() {
    return `${this.object}#${this.id}`;
  }
}

export interface WrappedPage<T> {
  data: T[];
  getNextPage: () => Promise<WrappedPage<T>>;
  iterPages: () => AsyncGenerator<WrappedPage<T>>;
  hasNextPage(): boolean;
  nextPageInfo():
    | { url: URL }
    | { params: Record<string, unknown> | null }
    | null;
  nextPageParams(): Partial<CursorPageParams> | null;
}

/**
 * Facade on top of the page object that wraps results in StatefulObjects
 * @param ctx
 * @param page openai cursor page
 * @param initializer factory function to create the wrapped object
 */
export const createWrappedPage = <
  Wrapped extends StatefulObject<any, Inner>,
  Inner extends { id: string },
>(
  ctx: Context,
  page: CursorPage<Inner>,
  initializer: (ctx: Context, id: string) => Wrapped,
): WrappedPage<Wrapped> => ({
  data: page.data.map((item) => {
    const value = initializer(ctx, item.id);
    ctx.cache.set(value.object, item.id, item);
    return value;
  }),
  getNextPage() {
    return page
      .getNextPage()
      .then((page) => createWrappedPage(ctx, page, initializer));
  },
  hasNextPage: page.hasNextPage,
  async *iterPages() {
    yield await page
      .iterPages()
      .next()
      .then((page) =>
        createWrappedPage(ctx, page.value as CursorPage<Inner>, initializer),
      );
  },
  nextPageInfo: page.nextPageInfo,
  nextPageParams: page.nextPageParams,
});
