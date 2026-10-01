// src/lib/dev-latency.ts
// Development latency telemetry monitor for EquaTranslate PRO

export interface LatencyDetail {
  mode?: "web_speech" | "whisper_fallback";
  chunkIndex?: number;
  sourceLanguage?: string;
  speechToReqMs?: number;
  clientToEdgeMs?: number;
  sourceInsertMs?: number;
  translationMs?: number;
  transInsertMs?: number;
  realtimeMs?: number;
  renderMs?: number;
  totalE2EMs?: number;
}

export class DevLatencyTracker {
  private static instance: DevLatencyTracker | null = null;
  private currentMetrics: LatencyDetail | null = null;
  private listeners: ((metrics: LatencyDetail) => void)[] = [];

  private constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("linguaclass:latency", (e: Event) => {
        const customEvent = e as CustomEvent<LatencyDetail>;
        if (customEvent.detail) {
          this.currentMetrics = customEvent.detail;
          this.listeners.forEach((fn) => fn(customEvent.detail));
        }
      });
    }
  }

  public static getInstance(): DevLatencyTracker {
    if (!DevLatencyTracker.instance) {
      DevLatencyTracker.instance = new DevLatencyTracker();
    }
    return DevLatencyTracker.instance;
  }

  public subscribe(fn: (metrics: LatencyDetail) => void): () => void {
    this.listeners.push(fn);
    if (this.currentMetrics) {
      fn(this.currentMetrics);
    }
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  public getLatest(): LatencyDetail | null {
    return this.currentMetrics;
  }
}
