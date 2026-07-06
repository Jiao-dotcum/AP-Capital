import { useEffect, useRef, useState } from 'react'

// ————— The picture gallery: public-domain old masters, hotlinked from
// Wikimedia Commons and dressed as numbered plates. Each plate carries
// candidate URLs (filenames occasionally change on Commons); if none load,
// the figure withdraws itself and the page stands without it.
const FP = (name, w = 1100) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${w}`

export const PLATES = {
  airpump: {
    numeral: 'I',
    title: 'An Experiment on a Bird in the Air Pump',
    credit: 'Joseph Wright of Derby, 1768',
    note: 'The mechanism, observed — cause and effect made visible to everyone around the table.',
    srcs: [
      FP('An Experiment on a Bird in an Air Pump by Joseph Wright of Derby, 1768.jpg'),
      FP('Joseph Wright of Derby - An Experiment on a Bird in an Air Pump.jpg'),
    ],
  },
  coleConsummation: {
    numeral: 'II',
    title: 'The Course of Empire — The Consummation',
    credit: 'Thomas Cole, 1836',
    note: 'Froth: marble everywhere, credit for everyone. Prices assume the parade goes on forever.',
    srcs: [FP('Cole Thomas The Consummation The Course of the Empire 1836.jpg')],
  },
  coleArcadian: {
    numeral: 'II',
    title: 'The Course of Empire — The Arcadian State',
    credit: 'Thomas Cole, 1836',
    note: 'Mid-cycle: neither triumph nor ruin. The pendulum rests near the middle of its arc.',
    srcs: [FP('Cole Thomas The Course of Empire The Arcadian or Pastoral State 1836.jpg')],
  },
  coleDestruction: {
    numeral: 'II',
    title: 'The Course of Empire — Destruction',
    credit: 'Thomas Cole, 1836',
    note: 'Despair: the forced sellers are in the streets. This is when the buying is done.',
    srcs: [FP('Cole Thomas The Course of Empire Destruction 1836.jpg')],
  },
  poussin: {
    numeral: 'III',
    title: 'A Dance to the Music of Time',
    credit: 'Nicolas Poussin, c. 1636',
    note: 'The seasons take turns and the round never stops — hold something for each of them.',
    srcs: [
      FP('Nicolas Poussin - A Dance to the Music of Time - WGA18294.jpg'),
      FP('The dance to the music of time c. 1640.jpg'),
    ],
  },
  oath: {
    numeral: 'IV',
    title: 'Oath of the Horatii',
    credit: 'Jacques-Louis David, 1784',
    note: 'Each layer swears to its artifact. Nothing trades without the oath.',
    srcs: [
      FP('Jacques-Louis David - Oath of the Horatii - Google Art Project.jpg'),
      FP('Jacques-Louis David, Le Serment des Horaces.jpg'),
      FP('Le Serment des Horaces - Jacques-Louis David - Musée du Louvre.jpg'),
    ],
  },
  socrates: {
    numeral: 'V',
    title: 'The Death of Socrates',
    credit: 'Jacques-Louis David, 1787',
    note: 'Principle over comfort. When the ceiling is breached, the override is refused.',
    srcs: [
      FP('David - The Death of Socrates.jpg'),
      FP('Jacques-Louis David - The Death of Socrates.jpg'),
    ],
  },
}

export function Plate({ plate }) {
  const [idx, setIdx] = useState(0)
  const [dead, setDead] = useState(false)
  const imgRef = useRef(null)

  const fail = () => (idx + 1 < plate.srcs.length ? setIdx(idx + 1) : setDead(true))

  // The error event can fire before React attaches the handler (fast
  // connection refusals); sweep for silently-broken images after mount.
  useEffect(() => {
    if (dead) return undefined
    const t = setInterval(() => {
      const img = imgRef.current
      if (img && img.complete && img.naturalWidth === 0) fail()
    }, 700)
    return () => clearInterval(t)
  })

  if (dead) return null

  return (
    <figure className="plate">
      <div className="plate__frame">
        <img
          ref={imgRef}
          src={plate.srcs[idx]}
          alt={`${plate.title} — ${plate.credit}`}
          loading="lazy"
          onError={fail}
        />
      </div>
      <figcaption>
        <div className="plate__caption lbl lbl--ink">
          Plate {plate.numeral} · {plate.title}
        </div>
        <div className="plate__credit lbl">{plate.credit} · public domain</div>
        <div className="plate__note">{plate.note}</div>
      </figcaption>
    </figure>
  )
}
