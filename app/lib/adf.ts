// Lightweight ADF test for residual/spread (Engle–Granger step 2)
// Model: Δy_t = a + b*y_{t-1} + e_t
// We return the t-stat of b and a coarse PASS/FAIL using approximate
// critical values (no trend, 5% ~ -2.86, 10% ~ -2.57).
// This is not an exact p-value, but it's good for a fast browser screener.

function mean(x: number[]) {
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

function variance(x: number[]) {
  const m = mean(x);
  let s2 = 0;
  for (const v of x) {
    const d = v - m;
    s2 += d * d;
  }
  return s2 / (x.length - 1);
}

export function adfTestResidual(y: number[]) {
  if (!y || y.length < 60) {
    return { tStat: null as number | null, pass5: null as boolean | null, pass10: null as boolean | null };
  }

  const dy: number[] = [];
  const yLag: number[] = [];
  for (let t = 1; t < y.length; t++) {
    dy.push(y[t] - y[t - 1]);
    yLag.push(y[t - 1]);
  }

  const n = dy.length;
  const x = yLag;
  const xMean = mean(x);
  const yMean = mean(dy);

  // OLS slope b = cov(x, dy) / var(x)
  let cov = 0;
  for (let i = 0; i < n; i++) cov += (x[i] - xMean) * (dy[i] - yMean);
  cov /= (n - 1);

  const varX = variance(x);
  if (!isFinite(varX) || varX <= 0) {
    return { tStat: null as number | null, pass5: null as boolean | null, pass10: null as boolean | null };
  }

  const b = cov / varX;
  const a = yMean - b * xMean;

  // residuals
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const yHat = a + b * x[i];
    const e = dy[i] - yHat;
    sse += e * e;
  }

  const dof = n - 2;
  if (dof <= 0) {
    return { tStat: null as number | null, pass5: null as boolean | null, pass10: null as boolean | null };
  }

  const sigma2 = sse / dof;
  const seB = Math.sqrt(sigma2 / ((n - 1) * varX));
  if (!isFinite(seB) || seB === 0) {
    return { tStat: null as number | null, pass5: null as boolean | null, pass10: null as boolean | null };
  }

  const tStat = b / seB;

  // Approx critical values (no trend). Negative more extreme => more stationary.
  const pass5 = tStat < -2.86;
  const pass10 = tStat < -2.57;

  return { tStat, pass5, pass10 };
}
