import { SIGMA_MAX, regimeOf } from '../engine/machine.js'

const SIZE = 460
const PAD = 44
const HALF = (SIZE - 2 * PAD) / 2
const CX = SIZE / 2
const CY = SIZE / 2

const x = (g) => CX + (g / SIGMA_MAX) * HALF
const y = (i) => CY - (i / SIGMA_MAX) * HALF

const QUAD_RECTS = {
  'rising-rising': [CX, PAD, CX + HALF, CY],
  'falling-rising': [PAD, PAD, CX, CY],
  'rising-falling': [CX, CY, CX + HALF, CY + HALF],
  'falling-falling': [PAD, CY, CX, CY + HALF],
}

// SVG macro compass: growth surprise on x, inflation surprise on y,
// current reading + dotted trail of prior readings, active quadrant tinted.
export default function Compass({ trail }) {
  const current = trail[trail.length - 1]
  const regime = regimeOf(current)
  const [qx, qy] = [QUAD_RECTS[regime.key][0], QUAD_RECTS[regime.key][1]]

  const trailPts = trail.map((r) => `${x(r.g)},${y(r.i)}`).join(' ')
  const ticks = [-1.6, -0.8, 0, 0.8, 1.6]

  return (
    <div>
      <svg
        className="compass-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Macro compass. Growth surprise ${current.g} sigma, inflation surprise ${current.i} sigma. Regime: ${regime.label}.`}
      >
        {/* active quadrant tint */}
        <rect
          x={qx}
          y={qy}
          width={HALF}
          height={HALF}
          fill="var(--wedgwood)"
          opacity="0.08"
        />

        {/* hairline grid */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={PAD} x2={x(t)} y2={SIZE - PAD} stroke="var(--line)" strokeWidth="1" />
            <line x1={PAD} y1={y(t)} x2={SIZE - PAD} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
          </g>
        ))}

        {/* axes */}
        <line x1={CX} y1={PAD} x2={CX} y2={SIZE - PAD} stroke="var(--bronze)" strokeWidth="1.25" />
        <line x1={PAD} y1={CY} x2={SIZE - PAD} y2={CY} stroke="var(--bronze)" strokeWidth="1.25" />
        <rect x={PAD} y={PAD} width={SIZE - 2 * PAD} height={SIZE - 2 * PAD} fill="none" stroke="var(--bronze)" strokeWidth="1.25" />

        {/* axis titles */}
        <text x={SIZE - PAD} y={CY - 8} textAnchor="end" className="compass-axis">
          Growth Surprise σ →
        </text>
        <text x={CX + 8} y={PAD + 14} className="compass-axis">
          ↑ Inflation Surprise σ
        </text>

        {/* tick labels */}
        {[-1.6, -0.8, 0.8, 1.6].map((t) => (
          <text key={`gx${t}`} x={x(t)} y={SIZE - PAD + 16} textAnchor="middle" className="compass-tick">
            {t > 0 ? `+${t}` : t}
          </text>
        ))}
        {[-1.6, -0.8, 0.8, 1.6].map((t) => (
          <text key={`iy${t}`} x={PAD - 8} y={y(t) + 3} textAnchor="end" className="compass-tick">
            {t > 0 ? `+${t}` : t}
          </text>
        ))}

        {/* quadrant inscriptions */}
        <QuadLabel xPos={SIZE - PAD - 10} yPos={PAD + 26} anchor="end" title="Growth ↑ · Inflation ↑" assets="Commodities · Gold · ILBs" />
        <QuadLabel xPos={PAD + 10} yPos={PAD + 26} anchor="start" title="Growth ↓ · Inflation ↑" assets="Gold · ILBs" />
        <QuadLabel xPos={SIZE - PAD - 10} yPos={SIZE - PAD - 34} anchor="end" title="Growth ↑ · Inflation ↓" assets="Equities · Credit" />
        <QuadLabel xPos={PAD + 10} yPos={SIZE - PAD - 34} anchor="start" title="Growth ↓ · Inflation ↓" assets="Nominal Bonds" />

        {/* dotted trail of prior readings */}
        {trail.length > 1 && (
          <polyline
            points={trailPts}
            fill="none"
            stroke="var(--bronze)"
            strokeWidth="1.25"
            strokeDasharray="2 5"
          />
        )}
        {trail.slice(0, -1).map((r, k) => (
          <circle key={k} cx={x(r.g)} cy={y(r.i)} r="3" fill="var(--stone)" stroke="var(--bronze)" strokeWidth="1.25" />
        ))}

        {/* current reading: a square mark on the axis of the machine */}
        <g transform={`translate(${x(current.g)} ${y(current.i)})`}>
          <rect x="-9" y="-9" width="18" height="18" fill="none" stroke="var(--wedgwood)" strokeWidth="1.25" />
          <rect x="-4.5" y="-4.5" width="9" height="9" fill="var(--wedgwood)" />
        </g>
      </svg>

      <p className="regime-line">
        <span className="lbl">Diagnosed regime — </span>
        <strong>{regime.label}</strong>
        <br />
        <span className="lbl lbl--bronze">Favors {regime.favored}</span>
      </p>

      <style>{`
        .compass-axis {
          font-family: var(--font-mono);
          font-size: 10.5px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          fill: var(--bronze);
        }
        .compass-tick {
          font-family: var(--font-mono);
          font-size: 10px;
          fill: var(--limestone);
        }
        .compass-quad-title {
          font-family: var(--font-mono);
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          fill: var(--ink);
        }
        .compass-quad-assets {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          fill: var(--limestone);
        }
      `}</style>
    </div>
  )
}

function QuadLabel({ xPos, yPos, anchor, title, assets }) {
  return (
    <g>
      <text x={xPos} y={yPos} textAnchor={anchor} className="compass-quad-title">
        {title}
      </text>
      <text x={xPos} y={yPos + 14} textAnchor={anchor} className="compass-quad-assets">
        {assets}
      </text>
    </g>
  )
}
