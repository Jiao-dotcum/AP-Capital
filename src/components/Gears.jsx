import { gearsFrom } from '../engine/machine.js'

// The three gears that drive the machine, alongside the compass.
export default function Gears({ current }) {
  const gears = gearsFrom(current)
  const dsrPct = (gears.debtServiceRatio / gears.debtServiceThreshold) * 100
  const dsrWarn = gears.debtServiceRatio >= gears.debtServiceThreshold

  return (
    <div>
      <div className="gear">
        <div className="lbl">Gear One — Productivity Growth</div>
        <div className="gear__figure">+{gears.productivity.toFixed(1)}% / yr</div>
        <p className="gear__note">
          The multi-decade trend. Knowledge compounds; over any horizon that matters, output per
          person rises. Everything else oscillates around this line.
        </p>
      </div>

      <div className="gear">
        <div className="lbl">Gear Two — Short-Term Debt Cycle</div>
        <div className="gear__figure">{gears.shortCyclePct.toFixed(0)}% elapsed</div>
        <div className="gear__meter">
          <i style={{ width: `${gears.shortCyclePct}%` }} />
        </div>
        <p className="gear__note">
          The 5–8 year credit cycle. The gauge reads late-cycle as credit is extended past incomes
          and the central bank leans against it.
        </p>
      </div>

      <div className={`gear${dsrWarn ? ' gear--warn' : ''}`}>
        <div className="lbl">Gear Three — Long-Term Debt Cycle</div>
        <div className="gear__figure">
          {gears.debtServiceRatio.toFixed(1)}%{' '}
          <span className="lbl lbl--bronze">vs {gears.debtServiceThreshold}% threshold</span>
        </div>
        <div className={`gear__meter${dsrWarn ? ' gear__meter--warn' : ''}`}>
          <i style={{ width: `${Math.min(100, dsrPct)}%` }} />
        </div>
        <p className="gear__note">
          The 75–100 year cycle, read through the debt-service ratio. Past the threshold,
          deleveraging — beautiful or otherwise — becomes the dominant force.
        </p>
      </div>
    </div>
  )
}
