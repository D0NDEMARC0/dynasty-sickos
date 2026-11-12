// Projected NFL draft capital for college prospects.
// One small ridge regression per position, trained on every skill player who left college in recent years
// (drafted or not), and back-tested one draft year at a time so the reported accuracy is out-of-sample.

/** Ridge regression on standardized features (missing values filled with the training mean). */
export function ridge(X, y, lambda = 2) {
  const n = X.length, k = X[0].length;
  const fill = Array.from({ length: k }, (_, j) => {
    const v = X.map(r => r[j]).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  });
  const clean = r => r.map((v, j) => (Number.isFinite(v) ? v : fill[j]));
  const Z = X.map(clean);
  const mean = fill.map((_, j) => Z.reduce((s, r) => s + r[j], 0) / n);
  const sd = mean.map((m, j) => Math.sqrt(Z.reduce((s, r) => s + (r[j] - m) ** 2, 0) / n) || 1);
  const ym = y.reduce((a, b) => a + b, 0) / n;
  const A = Array.from({ length: k }, () => Array(k).fill(0)), B = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const z = Z[i].map((v, j) => (v - mean[j]) / sd[j]);
    for (let a = 0; a < k; a++) {
      B[a] += z[a] * (y[i] - ym);
      for (let b = a; b < k; b++) A[a][b] += z[a] * z[b];
    }
  }
  for (let a = 0; a < k; a++) { A[a][a] += lambda; for (let b = 0; b < a; b++) A[a][b] = A[b][a]; }
  const beta = solve(A, B);
  const f = x => ym + clean(x).reduce((s, v, j) => s + (beta[j] * (v - mean[j])) / sd[j], 0);
  f.beta = beta; // standardized coefficients: draft-capital points per 1 SD of each feature
  return f;
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

// average ranks (ties share the mean rank)
function ranks(v) {
  const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = Array(v.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let t = i; t <= j; t++) r[idx[t][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

export function spearman(a, b) {
  const n = a.length;
  if (n < 3) return null;
  const ra = ranks(a), rb = ranks(b), m = (n + 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - m) * (rb[i] - m); da += (ra[i] - m) ** 2; db += (rb[i] - m) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}

const avg = a => {
  const v = a.filter(x => x != null && Number.isFinite(x));
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100 : null;
};

/**
 * rows: { pos, year, x: number[], y } — y = draft capital of the pick (0 if undrafted).
 * Returns a predictor per position plus a leave-one-draft-year-out back-test:
 *   rho        rank correlation of predicted vs. actual draft capital, all players who left college that year
 *   rhoDrafted the same among drafted players only (does it order the picks?)
 *   hit        share of that year's drafted players found in the model's top N (N = number drafted)
 */
export function fitDraftModel(rows, { lambda = 2 } = {}) {
  const predict = {}, test = {};
  for (const pos of [...new Set(rows.map(r => r.pos))]) {
    const R = rows.filter(r => r.pos === pos);
    if (R.length < 50) continue;
    predict[pos] = ridge(R.map(r => r.x), R.map(r => r.y), lambda);
    const years = [...new Set(R.map(r => r.year))].sort((a, b) => a - b);
    const rho = [], rhoD = [], hit = [];
    for (const yr of years) {
      const tr = R.filter(r => r.year !== yr), te = R.filter(r => r.year === yr);
      if (tr.length < 50 || te.length < 10) continue;
      const f = ridge(tr.map(r => r.x), tr.map(r => r.y), lambda);
      const pred = te.map(r => f(r.x));
      rho.push(spearman(pred, te.map(r => r.y)));
      const d = te.map((r, i) => [pred[i], r.y]).filter(([, v]) => v > 0);
      rhoD.push(spearman(d.map(x => x[0]), d.map(x => x[1])));
      const top = new Set(pred.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]).slice(0, d.length).map(x => x[1]));
      if (d.length) hit.push(te.filter((r, i) => r.y > 0 && top.has(i)).length / d.length);
    }
    test[pos] = { players: R.length, drafted: R.filter(r => r.y > 0).length, years, rho: avg(rho), rhoDrafted: avg(rhoD), hit: avg(hit),
      beta: predict[pos].beta.map(b => Math.round(b * 10) / 10) };
  }
  return { predict, test };
}
