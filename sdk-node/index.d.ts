export interface ThrottleOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  failOpen?: boolean;
}

export interface CheckResult {
  allowed: boolean;
  remaining: number | null;
  resetMs: number | null;
  algoUsed?: string;
  warning?: string;
}

export class Throttle {
  constructor(opts: ThrottleOptions);
  check(identifier: string): Promise<CheckResult>;
  middleware(keyFn?: (req: any) => string): (req: any, res: any, next: any) => Promise<void>;
}
