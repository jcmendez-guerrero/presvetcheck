/**
 * Infraestructura HTTP común: limitador de peticiones por segundo, reintentos con backoff
 * exponencial + jitter en 5xx/timeouts y timeout por petición.
 */

export interface HttpOptions {
  /** Peticiones por segundo máximas. */
  rps: number;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  userAgent: string;
  /** Inyectables para tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export class HttpError extends Error {
  constructor(
    public readonly kind: 'HTTP' | 'TIMEOUT' | 'RED',
    public readonly status: number | null,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
  get retryable(): boolean {
    return this.kind !== 'HTTP' || this.status === 429 || (this.status !== null && this.status >= 500);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Limitador sencillo: espacia las peticiones al menos 1000/rps ms. */
export class RateLimiter {
  private next = 0;
  constructor(
    private readonly rps: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}
  async acquire(): Promise<void> {
    const interval = 1000 / Math.max(this.rps, 0.001);
    const t = this.now();
    const wait = Math.max(0, this.next - t);
    this.next = Math.max(t, this.next) + interval;
    if (wait > 0) await this.sleep(wait);
  }
}

export interface RequestInitLike {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
}

export class HttpClient {
  private readonly limiter: RateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly opts: HttpOptions) {
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
    this.limiter = new RateLimiter(opts.rps, opts.now, this.sleep);
  }

  /** Petición con reintentos. `retry=false` para operaciones no idempotentes (escrituras). */
  async request(
    url: string,
    init: RequestInitLike = {},
    retry = true,
  ): Promise<{ status: number; json: unknown }> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.once(url, init);
      } catch (e) {
        const err = e instanceof HttpError ? e : new HttpError('RED', null, String(e));
        if (!retry || !err.retryable || attempt >= this.opts.maxRetries) throw err;
        const delay = this.opts.baseDelayMs * 2 ** attempt;
        await this.sleep(delay + this.random() * delay);
        attempt++;
      }
    }
  }

  private async once(url: string, init: RequestInitLike): Promise<{ status: number; json: unknown }> {
    await this.limiter.acquire();
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: { 'User-Agent': this.opts.userAgent, Accept: 'application/json', ...init.headers },
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError')
        throw new HttpError('TIMEOUT', null, `Timeout tras ${this.opts.timeoutMs} ms`);
      throw new HttpError('RED', null, (e as Error).message);
    }
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (!res.ok) throw new HttpError('HTTP', res.status, `HTTP ${res.status}`, json);
    return { status: res.status, json };
  }
}
