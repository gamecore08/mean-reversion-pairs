export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s2 = 0;
  for (const x of xs) {
    const d = x - m;
    s2 += d * d;
  }
  return Math.sqrt(s2 / (xs.length - 1));
}

/**
 * OLS regression slope beta of y ~ beta*x + intercept
 * returns {beta, alpha} where alpha = intercept
 */
export function olsSlopeIntercept(x: number[], y: number[]): { beta: number; alpha: number } {
  const n = Math.min(x.length, y.length);
  if (n < 2) return { beta: NaN, alpha: NaN };

  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;

  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    den += dx * dx;
  }
  const beta = den === 0 ? NaN : num / den;
  const alpha = my - beta * mx;
  return { beta, alpha };
}

export function corr(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return NaN;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;

  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? NaN : num / den;
}


export function toLogSeries(prices: number[]): number[] {
  // Safe log to avoid -Infinity
  return prices.map((p) => Math.log(Math.max(p, 1e-12)));
}

export function logReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const p0 = Math.max(prices[i - 1], 1e-12);
    const p1 = Math.max(prices[i], 1e-12);
    out.push(Math.log(p1 / p0));
  }
  return out;
}

export function zscoreSeries(series: number[], window: number): number[] {
  const w = Math.max(2, Math.floor(window));
  const out: number[] = [];
  for (let i = 0; i < series.length; i++) {
    if (i < w - 1) {
      out.push(NaN);
      continue;
    }
    const slice = series.slice(i - w + 1, i + 1);
    const m = mean(slice);
    const sd = stdev(slice);
    out.push(!isFinite(sd) || sd === 0 ? NaN : (series[i] - m) / sd);
  }
  return out;
}
