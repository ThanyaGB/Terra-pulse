import type { RealtimeEvent } from './contract';

export type ConnectionState = 'connecting' | 'live' | 'polling' | 'offline';

/** The slice of WebSocket the client needs, so tests can inject a fake. */
export interface SocketLike {
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  close(): void;
}

export interface RealtimeOptions {
  /** WebSocket URL. When omitted the client goes straight to polling. */
  url?: string;
  /** Resolves the URL per connection attempt (e.g. with a fresh token). Takes precedence over `url`; undefined → polling. */
  getUrl?: () => Promise<string | undefined>;
  createSocket?: (url: string) => SocketLike;
  /** Poll source used while the socket is down. */
  fetchSnapshot: () => Promise<RealtimeEvent[]>;
  pollIntervalMs?: number;
  /** Delay before trying to re-open the socket after a drop. */
  reconnectMs?: number;
}

type Listener = (e: RealtimeEvent) => void;
type StateListener = (s: ConnectionState) => void;

/**
 * Subscribes to the live stream. If the socket drops (or never opens), it falls back to polling
 * `fetchSnapshot` and keeps trying to re-establish the socket in the background.
 */
export class RealtimeClient {
  private socket: SocketLike | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private stopped = true;
  private _state: ConnectionState = 'connecting';

  constructor(private opts: RealtimeOptions) {}

  get state(): ConnectionState {
    return this._state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    fn(this._state);
    return () => this.stateListeners.delete(fn);
  }

  start(): void {
    this.stopped = false;
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    this.stopPolling();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.close();
    }
  }

  private setState(s: ConnectionState) {
    if (s === this._state) return;
    this._state = s;
    this.stateListeners.forEach((l) => l(s));
  }

  private emit(e: RealtimeEvent) {
    this.listeners.forEach((l) => l(e));
  }

  private openSocket() {
    const { getUrl } = this.opts;
    if (!getUrl) return this.connect(this.opts.url);
    this.setState('connecting');
    getUrl().then((url) => { if (!this.stopped && !this.socket) this.connect(url); }, () => {
      this.fallbackToPolling();
      this.scheduleReconnect();
    });
  }

  private connect(url: string | undefined) {
    const { createSocket } = this.opts;
    if (!url) return this.fallbackToPolling();
    this.setState('connecting');
    let socket: SocketLike;
    try {
      socket = createSocket ? createSocket(url) : (new WebSocket(url) as unknown as SocketLike);
    } catch {
      return this.fallbackToPolling();
    }
    this.socket = socket;
    socket.onopen = () => {
      this.stopPolling();
      this.setState('live');
    };
    socket.onmessage = (m) => {
      try {
        const parsed = JSON.parse(m.data) as RealtimeEvent | RealtimeEvent[];
        (Array.isArray(parsed) ? parsed : [parsed]).forEach((e) => this.emit(e));
      } catch {
        /* ignore malformed frames */
      }
    };
    const dropped = () => {
      if (this.stopped || this.socket !== socket) return;
      this.socket = null;
      this.fallbackToPolling();
      this.scheduleReconnect();
    };
    socket.onclose = dropped;
    socket.onerror = dropped;
  }

  private scheduleReconnect() {
    if (this.stopped || !(this.opts.url || this.opts.getUrl)) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped && !this.socket) this.openSocket();
    }, this.opts.reconnectMs ?? 10_000);
  }

  private fallbackToPolling() {
    if (this.stopped) return;
    this.setState('polling');
    if (this.pollTimer) return;
    const tick = async () => {
      try {
        const events = await this.opts.fetchSnapshot();
        events.forEach((e) => this.emit(e));
        if (this._state === 'offline') this.setState('polling');
      } catch {
        this.setState('offline');
      }
    };
    void tick();
    this.pollTimer = setInterval(tick, this.opts.pollIntervalMs ?? 15_000);
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}
