// Technical indicator library. Operates on aligned arrays rather than a frame,
// because every indicator here is a pure transform of the close series.

import { isNum } from "@/lib/format";

export interface Bar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  dividend?: number;
}

export interface EnrichedBars {
  bars: Bar[];
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  rsi: (number | null)[];
  macd: (number | null)[];
  macdSignal: (number | null)[];
  macdHist: (number | null)[];
  bbUpper: (number | null)[];
  bbLower: (number | null)[];
  atr: (number | null)[];
  volSma20: (number | null)[];
}

export function sma(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let acc = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNum(v)) {
      acc += v;
      count++;
    }
    if (i >= window) {
      const drop = values[i - window];
      if (isNum(drop)) {
        acc -= drop;
        count--;
      }
    }
    if (i >= window - 1 && count === window) out[i] = acc / window;
  }
  return out;
}

/** Exponentially weighted mean with `adjust=false`, matching the source. */
export function ema(values: (number | null)[], span: number): (number | null)[] {
  const alpha = 2 / (span + 1);
  const out: (number | null)[] = new Array(values.length).fill(null);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) {
      out[i] = prev;
      continue;
    }
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export function rollingStd(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = window - 1; i < values.length; i++) {
    const slice = values.slice(i - window + 1, i + 1).filter(isNum) as number[];
    if (slice.length < window) continue;
    const m = slice.reduce((a, b) => a + b, 0) / slice.length;
    // Sample standard deviation, matching pandas' default ddof=1.
    out[i] = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / (slice.length - 1));
  }
  return out;
}

/** Wilder's RSI as the source computed it: simple rolling means of gains and
 *  losses over 14 periods. */
export function rsi(closes: (number | null)[], window = 14): (number | null)[] {
  const gains: (number | null)[] = [null];
  const losses: (number | null)[] = [null];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i];
    const b = closes[i - 1];
    if (!isNum(a) || !isNum(b)) {
      gains.push(null);
      losses.push(null);
      continue;
    }
    const delta = a - b;
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }
  const avgGain = sma(gains, window);
  const avgLoss = sma(losses, window);
  return closes.map((_, i) => {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (!isNum(g) || !isNum(l) || l === 0) return isNum(g) && l === 0 ? 100 : null;
    return 100 - 100 / (1 + g / l);
  });
}

export function enrich(bars: Bar[]): EnrichedBars {
  const closes = bars.map((b) => b.close);
  const sma20 = sma(closes, 20);
  const std20 = rollingStd(closes, 20);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = closes.map((_, i) =>
    isNum(ema12[i]) && isNum(ema26[i]) ? (ema12[i] as number) - (ema26[i] as number) : null,
  );
  const macdSignal = ema(macd, 9);
  const macdHist = macd.map((v, i) =>
    isNum(v) && isNum(macdSignal[i]) ? v - (macdSignal[i] as number) : null,
  );

  // True range: the largest of today's range, and each gap against yesterday's
  // close — so an overnight jump counts as volatility, which a high-low alone
  // would miss.
  const tr: (number | null)[] = bars.map((b, i) => {
    if (!isNum(b.high) || !isNum(b.low)) return null;
    const prevClose = i > 0 ? bars[i - 1].close : null;
    const candidates = [b.high - b.low];
    if (isNum(prevClose)) {
      candidates.push(Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
    }
    return Math.max(...candidates);
  });

  return {
    bars,
    sma20,
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi: rsi(closes, 14),
    macd,
    macdSignal,
    macdHist,
    bbUpper: sma20.map((m, i) => (isNum(m) && isNum(std20[i]) ? m + 2 * (std20[i] as number) : null)),
    bbLower: sma20.map((m, i) => (isNum(m) && isNum(std20[i]) ? m - 2 * (std20[i] as number) : null)),
    atr: sma(tr, 14),
    volSma20: sma(bars.map((b) => b.volume), 20),
  };
}

/** Last non-null entry of a derived series. */
export function lastOf(series: (number | null)[] | null | undefined): number | null {
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) if (isNum(series[i])) return series[i] as number;
  return null;
}
