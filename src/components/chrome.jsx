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
      <h1 className="masthead__title">The Complete Machine</h1>
      <p className="masthead__sub">Two Mandates, One Machine — AP Cycle Credit × AP All Weather Core · Simulated/Paper</p>
      <Meander />
    </header>
  )
}

// The two-fund structure: each mandate opens with its own nameplate. The
// decoupling gives each engine one clearly-bordered jurisdiction — the banner
// is that border, made visible.
export function MandateBanner({ kicker, name, engine, note }) {
  return (
    <div className="mandate">
      <div className="mandate__kicker">{kicker}</div>
      <h2 className="mandate__name">{name}</h2>
      <div className="mandate__engine">{engine}</div>
      <p className="mandate__note">{note}</p>
    </div>
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
      <p className="footer__disclaimer">
        <a href="/apcci.html">The AP Credit Cycle Index (APCCI)</a> — the firm’s one published,
        externally recomputable series. Unlike everything above it, it is built only from public
        FRED data and its values are final.
      </p>
    </footer>
  )
}

// A standing link from the dashboard to the published index. The index is a
// separate PAGE, not a section, and deliberately so: everything in the app is
// simulated or paper, while the index is the one artifact a stranger can
// recompute from public data. Mixing them on one canvas would blur exactly
// the boundary the Charter exists to keep sharp.
export function IndexLink() {
  return (
    <div className="panel panel--quiet" style={{ marginTop: 'var(--space-3)' }}>
      <h3 className="panel__title">Published Index — APCCI</h3>
      <p className="gear__note" style={{ marginBottom: 'var(--space-1)' }}>
        The dial above drives this simulation and cannot be reproduced outside it — four of its
        seven proxies are simulated and its baseline is a seeded climatology. The{' '}
        <strong>AP Credit Cycle Index</strong> is the publishable counterpart: five public FRED
        series through fixed, published anchor tables, so anyone can recompute every value.
        Incomplete inputs publish nothing; published values are never revised.
      </p>
      <a className="btn btn--outline btn--small" href="/apcci.html">Open the published index →</a>
    </div>
  )
}
