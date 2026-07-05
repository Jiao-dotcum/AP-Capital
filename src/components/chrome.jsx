// Structural chrome: pediment masthead, meander strip, section heads,
// column dividers, hardstop banner, footer.

export function Pediment() {
  return (
    <svg
      className="masthead__pediment"
      width="120"
      height="34"
      viewBox="0 0 120 34"
      aria-hidden="true"
    >
      {/* keystone triangle over stepped entablature lines */}
      <path d="M60 2 L86 20 L34 20 Z" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <line x1="60" y1="9" x2="60" y2="20" stroke="currentColor" strokeWidth="1" />
      <line x1="10" y1="25" x2="110" y2="25" stroke="currentColor" strokeWidth="1" />
      <line x1="22" y1="30" x2="98" y2="30" stroke="currentColor" strokeWidth="0.75" />
    </svg>
  )
}

// One restrained Greek-key strip. Appears exactly twice: under the masthead
// and above the footer.
export function Meander() {
  const unit = 24
  const n = 12
  const d = Array.from({ length: n }, (_, k) => {
    const x = k * unit
    return `M${x} 16 V4 H${x + 16} V12 H${x + 8} V8`
  }).join(' ')
  return (
    <svg
      className="meander"
      width={n * unit}
      height="20"
      viewBox={`0 0 ${n * unit} 20`}
      aria-hidden="true"
      style={{ maxWidth: '100%' }}
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export function Masthead() {
  return (
    <header className="masthead">
      <Pediment />
      <h1 className="masthead__title">The Economic Machine</h1>
      <p className="masthead__sub">An Investment Diagnostic · Systematic Macro</p>
      <Meander />
    </header>
  )
}

export function ColumnDivider() {
  return (
    <div className="divider" aria-hidden="true">
      <span className="divider__flute">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}

export function SectionHead({ numeral, title, note }) {
  return (
    <div className="section-head">
      <div className="section-head__numeral">Section {numeral}</div>
      <h2 className="section-head__title">{title}</h2>
      {note && <p className="section-head__note">{note}</p>}
    </div>
  )
}

export function HardstopBanner({ risk, ceiling }) {
  return (
    <div className="hardstop" role="alert">
      <div className="hardstop__word">Hardstop Engaged</div>
      <div className="hardstop__detail">
        Tail-loss probability {(risk * 100).toFixed(2)}% exceeds the {(ceiling * 100).toFixed(1)}%
        ceiling — positions scaled to 60% · hedges executed · manual override refused
      </div>
    </div>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <Meander />
      <p className="footer__motto">“Pain + Reflection = Progress.”</p>
      <div className="footer__rule" />
      <p className="footer__disclaimer">
        All expected returns, volatilities, betas, and carry figures are model assumptions for
        illustration. Nothing on this page is investment advice, an offer, or a solicitation.
      </p>
    </footer>
  )
}
