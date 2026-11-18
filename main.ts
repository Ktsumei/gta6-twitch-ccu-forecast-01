// GTA VI launch-day Twitch forecast (gta6-twitch-ccu-forecast-01).
//
// Method: a ratio-curve forecaster tuned by leave-one-out cross-validation on
// the kit's 38 comparable launches (mean pinball loss on the log scale).
//   - Every comparable launch contributes its release-day hourly curve,
//     normalised by its own hour-1 print: r_h = v_h / v_1. The forecast for
//     hour h is anchored on the case's own hour-1 print p1, so the scale of
//     GTA VI itself is taken from the live first hour, not guessed.
//   - Per hour, the centre is the WEIGHTED MEDIAN of log r_h across donors
//     (weights: comparable 1.0, early-access-contaminated 0.35, weak 0.2;
//     the GTA VI pre-release category history is not a launch day and is
//     excluded), and the spread is the weighted interquartile range turned
//     into a lognormal sd, capped at 0.75. Quantiles are
//     p1 * exp(median + z_tau * sd).
//   - A 15% log-space blend toward the house baseline (persistence with a
//     random-walk spread) hedges against the ratio model over-shooting on a
//     single unseen launch, and a 3-point moving average smooths the
//     quantile curves across adjacent hours.
//   - Fallback: an hour with fewer than 5 donors uses the house baseline.
// LOO results on the kit's comparables: baseline 0.930 mean pinball loss,
// this model 0.806; on the 9 console-first rolling-midnight launches most
// like GTA VI (the honest proxy for the final): baseline 0.393, this model
// 0.291. Deterministic: no randomness, no network, stdlib only.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** House baseline spread, in natural-log units per square-root hour. */
const BASE_SIGMA = 0.15;
/** Lognormal sd cap for the ratio spread. */
const SD_CAP = 0.75;
/** Log-space blend toward the house baseline. */
const BASELINE_BLEND = 0.15;
/** Donors needed for a ratio forecast of one hour; fewer falls back to baseline. */
const MIN_DONORS = 5;

interface HourPoint { from: string; viewers: number; channels?: number | null }
interface Comparable {
  name: string;
  day_start: string;
  unlock?: string;
  platforms?: string;
  hourly: HourPoint[];
}
interface Case {
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Weighted empirical quantile (step function): first value whose cumulative
 *  weight reaches tau of the total. `pairs` need not be sorted. */
const wQuantile = (pairs: Array<[number, number]>, tau: number): number => {
  const sorted = pairs.slice().sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [v, w] of sorted) {
    acc += w;
    if (acc >= tau * total) return v;
  }
  return sorted[sorted.length - 1][0];
};

/** Tier weight parsed from the comparable's unlock note. */
const tierWeight = (c: Comparable): number => {
  const u = (c.unlock ?? '').toLowerCase();
  if (u.includes('target-history')) return 0;
  if (u.includes('early-access-contaminated')) return 0.35;
  if (u.includes('tier: weak')) return 0.2;
  return 1;
};

/** Release-day hourly viewers of one comparable, keyed by hour 1..24. */
const releaseDay = (c: Comparable): Map<number, number> => {
  const day = Date.parse(c.day_start);
  const byHour = new Map<number, number>();
  for (const p of c.hourly ?? []) {
    const h = Math.floor((Date.parse(p.from) - day) / 3_600_000) + 1;
    if (h >= 1 && h <= 24 && typeof p.viewers === 'number' && p.viewers >= 0) {
      byHour.set(h, p.viewers);
    }
  }
  return byHour;
};

/** House baseline quantiles for one hour (persistence + widening spread). */
const baselineQuantiles = (p1: number, h: number): number[] =>
  Z.map((z) => Math.max(1, round2(p1 * Math.exp(z * BASE_SIGMA * Math.sqrt(h - 1)))));

/** Ratio-model quantiles for one hour from the donor pool. */
const ratioQuantiles = (
  p1: number,
  donors: Array<{ logRatios: Map<number, number>; weight: number }>,
  h: number,
): number[] | null => {
  const pairs: Array<[number, number]> = [];
  for (const d of donors) {
    const lr = d.logRatios.get(h);
    if (lr !== undefined) pairs.push([lr, d.weight]);
  }
  if (pairs.length < MIN_DONORS) return null;
  const med = wQuantile(pairs, 0.5);
  const q25 = wQuantile(pairs, 0.25);
  const q75 = wQuantile(pairs, 0.75);
  const sd = Math.min(SD_CAP, Math.max(0.05, (q75 - q25) / 1.349));
  return Z.map((z) => Math.max(1, p1 * Math.exp(med + z * sd)));
};

const forecastCase = (c: Case): Array<{ hour: number; q: number[] }> => {
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error('case has no hour-1 print');
  const p1 = Math.max(1, first.viewers);

  // Build the donor pool: each comparable's log-ratios to its own hour 1.
  const donors: Array<{ logRatios: Map<number, number>; weight: number }> = [];
  for (const comp of c.comparables ?? []) {
    const w = tierWeight(comp);
    if (w === 0) continue;
    const day = releaseDay(comp);
    const v1 = day.get(1);
    if (v1 === undefined || v1 < 1 || day.size < 18) continue;
    const logRatios = new Map<number, number>();
    for (const [h, v] of day) {
      if (h >= 2 && v > 0) logRatios.set(h, Math.log(v / v1));
    }
    donors.push({ logRatios, weight: w });
  }

  const raw = new Map<number, number[]>();
  for (const { hour: h } of c.forecast) {
    const ratio = ratioQuantiles(p1, donors, h);
    const base = baselineQuantiles(p1, h);
    if (ratio === null) {
      raw.set(h, base);
      continue;
    }
    // 15% log-space blend toward the house baseline.
    const blended = ratio.map((q, j) =>
      Math.exp((1 - BASELINE_BLEND) * Math.log(q) + BASELINE_BLEND * Math.log(base[j])),
    );
    raw.set(h, blended);
  }

  // 3-point moving average on log-quantiles across adjacent hours.
  const hours = c.forecast.map(({ hour }) => hour).sort((a, b) => a - b);
  return hours.map((h) => {
    const near = [h - 1, h, h + 1].filter((hh) => raw.has(hh));
    const q = LEVELS.map((_, j) => {
      const avg = near.reduce((s, hh) => s + Math.log(raw.get(hh)![j]), 0) / near.length;
      return avg;
    }).map((v) => Math.max(1, Math.min(1e9, round2(Math.exp(v)))));
    // Enforce non-decreasing quantiles after rounding.
    for (let j = 1; j < q.length; j++) q[j] = Math.max(q[j], q[j - 1]);
    return { hour: h, q };
  });
};

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const hours = forecastCase(c);
  if (hours.length !== 23) throw new Error(`${file}: expected 23 forecast rows, got ${hours.length}`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
