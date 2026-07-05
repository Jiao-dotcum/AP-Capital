// Systematised IF/THEN macro principles. Each fires (or stays dormant)
// against the current surprise pair. Manual override is not accepted;
// a principle changes only by rewrite plus a 100-year backtest.
export const PRINCIPLES = [
  {
    id: 'P·01',
    when: 'growth prints above what is priced AND policy is tightening',
    then: 'Short duration; overweight commodities',
    test: (g, i) => g > 0.5 && 0.6 * i + 0.4 * g > 0,
  },
  {
    id: 'P·02',
    when: 'inflation surprise exceeds +1σ',
    then: 'Long breakevens versus nominal bonds',
    test: (g, i) => i > 1,
  },
  {
    id: 'P·03',
    when: 'growth falls AND inflation rises — stagflation',
    then: 'Long gold and commodities; short equities',
    test: (g, i) => g < -0.3 && i > 0.3,
  },
  {
    id: 'P·04',
    when: 'both surprises sit within ±0.3σ of consensus',
    then: 'No tilt; hold the strategic baseline',
    test: (g, i) => Math.abs(g) <= 0.3 && Math.abs(i) <= 0.3,
  },
  {
    id: 'P·05',
    when: 'growth rises AND inflation falls — goldilocks',
    then: 'Overweight equities and credit; underweight gold',
    test: (g, i) => g > 0.3 && i < -0.3,
  },
  {
    id: 'P·06',
    when: 'growth falls below −0.5σ AND inflation falls — deflationary bust',
    then: 'Long nominal duration; long USD versus FX carry',
    test: (g, i) => g < -0.5 && i < -0.3,
  },
]

export function evaluatePrinciples(g, i) {
  return PRINCIPLES.map((p) => ({ ...p, fired: p.test(g, i) }))
}
