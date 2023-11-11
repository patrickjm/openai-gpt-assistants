import { DefaultListener, ListenerSignature, TypedEmitter } from "tiny-typed-emitter";
import { CacheItemEvents, ObjectType } from "./cache.js";
import { Context } from "./index.js";
import { CursorPage, CursorPageParams } from "openai/pagination.mjs";
import OpenAI from "openai";

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
  constructor(
    protected _ctx: Context,
    public readonly object: ObjectType,
    private readonly _id: string
  ) {
    super();
    this._subscribe();
  }

  public get wrappedValue(): Wrapped {
    const val = this._ctx.cache.get<Wrapped>(this.object, this._id);
    if (!val) {
      throw new Error(
        'Attempted to access wrapped value of a stateful object that has not been loaded. '
        + 'Do you need to call load()? Was the ID invalid?'
      );
    }
    return val;
  }
  protected get _cache() { return this._ctx.cache; }
  public get id() { return this._id; }

  /**
   * Fetches the object into the cache. Does not overwrite the value in the cache if already exists.
   */
  public async load() {
    await this._ctx.cache.getOrFetch(this.object, this._id);
  }

  /**
   * Fetches the object into the cache. Overwrites the value in the cache if already exists.
   */
  public async reload() {
    await this._ctx.cache.fetch(this.object, this._id);
  }

  private _subscribe() {
    const params = [this] as any;
    this._ctx.cache.emitter(this.object, this._id).on('cacheInserted', (_value) => {
      this.emit('cacheInserted', ...params);
    });
    this._ctx.cache.emitter(this.object, this._id).on('updated', (_value) => {
      this.emit('updated', ...params);
    });
    this._ctx.cache.emitter(this.object, this._id).on('cacheRemoved', () => {
      this.emit('cacheRemoved', ...params);
    });
    this._ctx.cache.emitter(this.object, this._id).on('fetched', (_value) => {
      this.emit('fetched', ...params);
    });
    this._ctx.cache.emitter(this.object, this._id).on('created', (_value) => {
      this.emit('created', ...params);
    });
    this._ctx.cache.emitter(this.object, this._id).on('deleted', () => {
      this.emit('deleted', ...params);
    });
  }
}

export interface WrappedPage<T> {
  data: T[];
  getNextPage: () => Promise<WrappedPage<T>>;
  iterPages: () => AsyncGenerator<WrappedPage<T>>;
  hasNextPage(): boolean;
  nextPageInfo(): { url: URL } | { params: Record<string, unknown> | null } | null;
  nextPageParams(): Partial<CursorPageParams> | null;
}

/**
 * Facade on top of the page object that wraps results in StatefulObjects
 * @param ctx
 * @param page openai cursor page
 * @param initializer factory function to create the wrapped object
 */
export const createWrappedPage = <Wrapped extends StatefulObject<any, Inner>, Inner extends { id: string }>(
  ctx: Context,
  page: CursorPage<Inner>,
  initializer: (ctx: Context, id: string) => Wrapped
): WrappedPage<Wrapped> => ({
  data: page.data.map((item) => {
    const value = initializer(ctx, item.id)
    ctx.cache.set(value.object, item.id, item);
    return value;
  }),
  getNextPage() {
    return page.getNextPage().then(page => createWrappedPage(ctx, page, initializer));
  },
  hasNextPage: page.hasNextPage,
  async * iterPages() {
    yield await page.iterPages()
      .next()
      .then(page => createWrappedPage(ctx, page.value as CursorPage<Inner>, initializer));
  },
  nextPageInfo: page.nextPageInfo,
  nextPageParams: page.nextPageParams,
});