import { useMemo, useState } from "react";

// ---------- Acoustics ----------
// A brass instrument's playable pitches are the harmonics (partials) of the
// air column's fundamental. The slide lengthens the column: to lower a partial
// by n semitones the effective length must grow by 2^(n/12). Because the slide
// is a U, each cm of hand travel adds two cm of tubing, hence the /2 below.
//
// The "effective length" is the acoustic length (physical tube + bell end
// correction), which is what actually sets the harmonic frequencies. ~2.94 m
// puts 7th position at ~61 cm, which matches a real tenor trombone; the
// physical tubing is closer to 2.75 m but the bell makes it "sound" longer.

const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const midiToName = (m) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const midiToFreq = (m, a4) => a4 * Math.pow(2, (m - 69) / 12);

const BB_FUNDAMENTAL_MIDI = 34; // Bb1, the pedal in 1st position (open horn)
const F_FUNDAMENTAL_MIDI = 29;  // F1, the pedal with the valve engaged
const MAX_PARTIAL = 12;
const MAX_POSITION = 7;
// Partials further than this from an equal-tempered note (the 7th and 11th)
// are alternates in the standard position chart, not the default fingering.
const IN_TUNE_CENTS = 20;
const ORDINAL = (n) => n + (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");

function analyseNote(targetMidi, { a4, effLength, maxExt, trigger }) {
  const fundMidi = trigger ? F_FUNDAMENTAL_MIDI : BB_FUNDAMENTAL_MIDI;
  // Engaging the F valve adds tubing, so the whole position map stretches by
  // the same 2^(5/12) ratio that drops the fundamental a fourth.
  const L0 = trigger ? effLength * Math.pow(2, 5 / 12) : effLength;
  const f1 = midiToFreq(fundMidi, a4);
  const fTarget = midiToFreq(targetMidi, a4);
  const nominalExt = (p) => (L0 * (Math.pow(2, (p - 1) / 12) - 1)) / 2;

  const candidates = [];
  for (let n = 1; n <= MAX_PARTIAL; n++) {
    const fOpen = n * f1;
    const centsBelowOpen = 1200 * Math.log2(fOpen / fTarget);
    // Anything more than 60¢ above 1st position can't be reached even by
    // lipping; anything well past the furthest playable position likewise.
    if (centsBelowOpen < -60) continue;
    const ratio = fOpen / fTarget;
    const ext = (L0 * (ratio - 1)) / 2;
    if (ext > maxExt + 0.06) continue;

    const position = Math.min(MAX_POSITION, Math.max(1, Math.round(centsBelowOpen / 100) + 1));
    const deltaCents = centsBelowOpen - 100 * (position - 1);
    const deltaCm = (ext - nominalExt(position)) * 100;
    const reachable = ext >= -1e-6 && ext <= maxExt;
    // A note just past the end of the slide is often only a few cents sharp
    // there, which is lippable, so report the shortfall in cents as well.
    const centsSharpAtMax = ext > maxExt ? 1200 * Math.log2((L0 + 2 * ext) / (L0 + 2 * maxExt)) : 0;
    candidates.push({
      partial: n,
      openNote: midiToName(fundMidi + Math.round(12 * Math.log2(n))),
      ext,
      position,
      deltaCents,
      deltaCm,
      reachable,
      centsSharpAtMax,
    });
  }
  return { candidates, nominalExt, L0, fTarget };
}

// ---------- Audio ----------
// A PeriodicWave with a trombone-ish harmonic rolloff gives a far more
// instrument-like tone than a bare sawtooth, with no library and no samples.
// The context is created lazily inside a click handler because browsers refuse
// to start audio without a user gesture (Safari is strictest about this).
let audioCtx = null;
let brassWave = null;

function getAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const N = 14;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    for (let n = 1; n < N; n++) {
      // Middle harmonics slightly boosted relative to a plain 1/n rolloff:
      // that's where the brass "buzz" lives.
      const boost = n >= 2 && n <= 5 ? 1.4 : 1;
      imag[n] = boost / Math.pow(n, 1.25);
    }
    brassWave = audioCtx.createPeriodicWave(real, imag, { disableNormalization: false });
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq, startAt, duration, gain = 0.25) {
  const ctx = getAudio();
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(brassWave);
  osc.frequency.value = freq;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  // Tracking the cutoff with pitch keeps low notes from sounding muddy and
  // high notes from sounding thin.
  filter.frequency.value = Math.min(6000, freq * 6);
  filter.Q.value = 0.7;

  const env = ctx.createGain();
  const t0 = ctx.currentTime + startAt;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.05);
  env.gain.setValueAtTime(gain, t0 + duration - 0.12);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(filter).connect(env).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

// ---------- Drawing ----------
const PX_PER_CM = 4.4;
const CROOK_TIP_CLOSED = 434; // x of the outer-slide crook when fully in

function TromboneSVG({ extCm, nominalExtCm, candidate, colors, reachable, positionLabel }) {
  const e = Math.max(-12, Math.min(72, extCm)) * PX_PER_CM;
  const { brass, silver, ink, muted, warn, bg } = colors;

  return (
    <svg viewBox="0 0 820 290" className="w-full" role="img" aria-label="Trombone with slide position">
      {/* neckpipe from the bottom inner tube back to the tuning slide */}
      <path d="M100 210 H 62 A 20 20 0 0 1 42 190 V 118 A 18 18 0 0 1 60 100" fill="none" stroke={brass} strokeWidth="9" strokeLinecap="round" />
      {/* bell tube and flare */}
      <path d="M60 100 H 560" fill="none" stroke={brass} strokeWidth="11" />
      <path d="M560 94 C 660 94, 700 80, 780 58 L 780 142 C 700 120, 660 106, 560 106 Z" fill={brass} stroke={brass} strokeWidth="1" />
      <ellipse cx="780" cy="100" rx="6" ry="43" fill={bg} stroke={brass} strokeWidth="4" />

      {/* inner slide (fixed) */}
      <line x1="100" y1="165" x2="410" y2="165" stroke={silver} strokeWidth="6" opacity="0.7" />
      <line x1="100" y1="210" x2="410" y2="210" stroke={silver} strokeWidth="6" opacity="0.7" />
      <line x1="120" y1="165" x2="120" y2="210" stroke={silver} strokeWidth="4" />

      {/* outer slide (moves) */}
      <g transform={`translate(${e} 0)`}>
        <line x1="108" y1="165" x2="412" y2="165" stroke={silver} strokeWidth="11" />
        <line x1="108" y1="210" x2="412" y2="210" stroke={silver} strokeWidth="11" />
        <path d="M412 165 A 22.5 22.5 0 0 1 412 210" fill="none" stroke={silver} strokeWidth="11" />
        <line x1="150" y1="165" x2="150" y2="210" stroke={silver} strokeWidth="5" />
        <circle cx="150" cy="187" r="4" fill={ink} />
      </g>

      {/* mouthpiece */}
      <path d="M100 165 H 78 L 66 156 V 174 L 78 165" fill={brass} stroke={brass} strokeWidth="6" strokeLinejoin="round" />

      {/* position scale under the slide */}
      <line x1={CROOK_TIP_CLOSED} y1="248" x2={CROOK_TIP_CLOSED + 66 * PX_PER_CM} y2="248" stroke={muted} strokeWidth="1" />
      {nominalExtCm.map((cm, i) =>
        cm <= 66 ? (
          <g key={i} transform={`translate(${CROOK_TIP_CLOSED + cm * PX_PER_CM} 248)`}>
            <line y1="-6" y2="6" stroke={i + 1 === candidate?.position ? ink : muted} strokeWidth={i + 1 === candidate?.position ? 2 : 1} />
            <text y="24" textAnchor="middle" fontSize="14" fill={i + 1 === candidate?.position ? ink : muted}>
              {positionLabel(i + 1)}
            </text>
          </g>
        ) : null,
      )}
      {candidate && (
        <g transform={`translate(${CROOK_TIP_CLOSED + extCm * PX_PER_CM} 248)`}>
          <path d="M0 -14 L -7 -26 L 7 -26 Z" fill={reachable ? brass : warn} />
          <line y1="-14" y2="8" stroke={reachable ? brass : warn} strokeWidth="2" />
        </g>
      )}
    </svg>
  );
}

function BassStaffSVG({ midi, colors }) {
  const { ink, muted } = colors;
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  // Staff position is diatonic, so it's driven by the letter, not the semitone:
  // Db and D sit on the same line, differing only by the accidental.
  const letterStep = "CDEFGAB".indexOf(name[0]);
  const step = octave * 7 + letterStep;
  const BOTTOM_LINE_STEP = 2 * 7 + 4; // G2 is the bottom line of the bass staff
  const HALF = 5; // half a line-space in px
  const bottomY = 110;
  const yOf = (s) => bottomY - (s - BOTTOM_LINE_STEP) * HALF;
  const noteX = 118;

  const ledger = [];
  for (let s = BOTTOM_LINE_STEP - 2; s >= step; s -= 2) ledger.push(s);
  for (let s = BOTTOM_LINE_STEP + 10; s <= step; s += 2) ledger.push(s);

  return (
    <svg viewBox="0 0 200 184" className="w-full" role="img" aria-label={`${midiToName(midi)} on a bass clef staff`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1="10" x2="190" y1={yOf(BOTTOM_LINE_STEP + 2 * i)} y2={yOf(BOTTOM_LINE_STEP + 2 * i)} stroke={muted} strokeWidth="1" />
      ))}
      {/* bass clef: curl starting on the F line, with the two dots either side of it */}
      <path d="M24 80 C24 66 48 61 50 76 C52 93 36 109 18 117" fill="none" stroke={ink} strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="24" cy="80" r="3.6" fill={ink} />
      <circle cx="58" cy="74" r="2.4" fill={ink} />
      <circle cx="58" cy="86" r="2.4" fill={ink} />
      {ledger.map((s) => (
        <line key={s} x1={noteX - 12} x2={noteX + 12} y1={yOf(s)} y2={yOf(s)} stroke={muted} strokeWidth="1.2" />
      ))}
      {name.length > 1 && (
        <text x={noteX - 22} y={yOf(step) + 6} fontSize="24" fill={ink} fontFamily="serif">
          ♭
        </text>
      )}
      <ellipse cx={noteX} cy={yOf(step)} rx="6.5" ry="4.4" transform={`rotate(-20 ${noteX} ${yOf(step)})`} fill="none" stroke={ink} strokeWidth="2.6" />
      {/* Kept below the lowest pedal (C1, five ledger lines down) so it never overlaps the note. */}
      <text x="190" y="178" textAnchor="end" fontSize="11" fill={muted}>
        {midiToName(midi)} · bass clef
      </text>
    </svg>
  );
}

// The partial table is computed rather than typed so it can't drift from the
// model that drives the rest of the page.
function HowItWorks({ colors, effLength }) {
  const { brass, muted, panel } = colors;
  // The explanation always describes the open horn, whatever the valve
  // setting, so these are derived from effLength rather than the live series.
  const openExtCm = (p) => (effLength * (Math.pow(2, (p - 1) / 12) - 1) * 100) / 2;
  const triggerExtCm = (p) => openExtCm(p) * Math.pow(2, 5 / 12);
  const partials = Array.from({ length: MAX_PARTIAL }, (_, i) => {
    const n = i + 1;
    const semis = 12 * Math.log2(n);
    const cents = 100 * (semis - Math.round(semis));
    return { n, note: midiToName(BB_FUNDAMENTAL_MIDI + Math.round(semis)), cents };
  });
  const fmtCents = (c) => (Math.abs(c) < 0.5 ? "0" : `${c > 0 ? "+" : "−"}${Math.abs(c).toFixed(0)}`);

  return (
    <div id="how-it-works" className="mt-3 space-y-4 rounded p-4 text-sm leading-relaxed" style={{ background: panel }}>
      <p>
        A trombone can only sound the <em>partials</em> of its air column: whole-number multiples of a fundamental. With the slide
        closed that fundamental is Bb1, so the open horn gives Bb1, Bb2, F3, Bb3, D4, F4, Ab4, Bb4, C5, D5, E5, F5. The slide
        lengthens the column, lowering every partial together; each position is meant to drop the pitch by one semitone.
      </p>

      <p>
        The catch is that the harmonic series and the equal-tempered scale don't line up. Some partials fall very close to a
        scale note (2, 3, 4, 6, 8, 9, 12); others miss by an amount you can hear. Those misses carry over to every slide
        position, which is why a note like D4 needs the slide slightly in or out depending on which partial you play it on:
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-left" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead style={{ color: muted }}>
            <tr>
              <th className="pr-3 font-normal">Partial</th>
              {partials.map((p) => (
                <th key={p.n} className="px-1 text-center font-normal">
                  {p.n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pr-3" style={{ color: muted }}>
                Note in 1st
              </td>
              {partials.map((p) => (
                <td key={p.n} className="px-1 text-center">
                  {p.note}
                </td>
              ))}
            </tr>
            <tr>
              <td className="pr-3" style={{ color: muted }}>
                Offset (¢)
              </td>
              {partials.map((p) => (
                <td key={p.n} className="px-1 text-center" style={{ color: Math.abs(p.cents) >= 10 ? brass : undefined }}>
                  {fmtCents(p.cents)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        <strong>Where the centimetres come from.</strong> Lowering a pitch by <em>n</em> semitones requires the effective tube
        length to grow by a factor of 2<sup>n/12</sup>, so positions get farther apart as you go out: the distance from 1st to
        2nd is about {openExtCm(2).toFixed(1)} cm, but from 6th to 7th it's {(openExtCm(7) - openExtCm(6)).toFixed(1)} cm.
        The slide is a U, so moving your hand 1 cm adds 2 cm of tubing. For a chosen note and partial the app solves for the
        exact length, converts it to hand travel, and reports both the total extension and the difference from the nearest
        equal-tempered mark, in centimetres and cents.
      </p>

      <p>
        <strong>Effective length.</strong> The {effLength.toFixed(2)} m used here is the <em>acoustic</em> length of the open
        horn, which is what actually fixes the partial frequencies. It's a bit longer than the physical tubing (roughly 2.75 m
        on a tenor) because the bell and mouthpiece make the instrument behave as though it were longer. This value sets the spacing
        of every position, which is why it's adjustable: if your 7th sits at 59 cm rather than 61, lower it slightly.
      </p>

      <p>
        <strong>F attachment.</strong> Engaging the valve adds tubing that drops the fundamental a fourth to F1, which
        multiplies the effective length by 2<sup>5/12</sup> ≈ 1.33. The whole position map stretches by the same factor, so
        trigger positions are wider apart and only six fit on the slide: T6 (low C) sits at about {triggerExtCm(6).toFixed(1)} cm,
        right at the end, and a T7 (low B) would need about {triggerExtCm(7).toFixed(0)} cm. The app recomputes everything from the
        F series when the valve is engaged.
      </p>

      <p style={{ color: muted }}>
        <strong>What this model ignores.</strong> Real trombones aren't perfect harmonic series: the bell, leadpipe and
        mouthpiece shift individual partials by a few cents, differently on every instrument. Where 1st position "really" is
        depends on how the tuning slide is set, and many players keep it slightly out to leave room to adjust inward. Pedal
        tones (the 1st partial) are especially loose. Treat the direction of each correction as reliable and the exact
        millimetres as a starting point for your ears.
      </p>
    </div>
  );
}

// ---------- App ----------
const COLORS = {
  bg: "#1B2A41",
  panel: "#22344E",
  brass: "#D4A84B",
  silver: "#B9C0C8",
  ink: "#F1EBD8",
  muted: "#7F90A8",
  warn: "#C97B7B",
};

const LOWEST_OPEN_MIDI = 28; // E1, the lowest pedal in 7th position
const LOWEST_TRIGGER_MIDI = 24; // C1, the pedal in T6
const HIGHEST_MIDI = 77; // F5, 12th partial in 1st

export default function TromboneSlideSimulator() {
  const [midi, setMidi] = useState(62); // D4: the classic "which partial?" note
  const [partial, setPartial] = useState(null);
  const [a4, setA4] = useState(440);
  const [effLength, setEffLength] = useState(2.94);
  const [maxExtCm, setMaxExtCm] = useState(67);
  const [trigger, setTrigger] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHow, setShowHow] = useState(false);

  const params = { a4, effLength, maxExt: maxExtCm / 100, trigger };
  const { candidates, nominalExt, fTarget } = useMemo(() => analyseNote(midi, params), [midi, a4, effLength, maxExtCm, trigger]);

  // Follow the user's chosen partial when it exists for this note. Otherwise
  // default to the lowest reachable partial that sits close to equal
  // temperament, which is what the standard position chart does (G4 is 4th on
  // the 8th partial, not a short 2nd on the 7th). Fall back to anything
  // reachable, then to anything at all so an out-of-reach note is still shown.
  const chosen =
    candidates.find((c) => c.partial === partial) ??
    candidates.find((c) => c.reachable && Math.abs(c.deltaCents) < IN_TUNE_CENTS) ??
    candidates.find((c) => c.reachable) ??
    candidates[0] ??
    null;

  const [playing, setPlaying] = useState(null); // "note" | "compare" | null

  // Pitch the partial would actually produce if the slide were parked exactly
  // on the equal-tempered mark for this position, i.e. the "textbook" pitch
  // before any in/out correction.
  const nominalFreq = chosen ? fTarget * Math.pow(2, chosen.deltaCents / 1200) : null;

  const withBusy = (label, seconds) => {
    setPlaying(label);
    setTimeout(() => setPlaying(null), seconds * 1000);
  };

  const playNote = () => {
    playTone(fTarget, 0, 1.2);
    withBusy("note", 1.3);
  };

  // Textbook position, then corrected, then both together so the beating
  // makes the cents difference audible even when the two alone sound alike.
  const playCompare = () => {
    playTone(nominalFreq, 0, 1.0);
    playTone(fTarget, 1.1, 1.0);
    playTone(nominalFreq, 2.2, 1.6, 0.18);
    playTone(fTarget, 2.2, 1.6, 0.18);
    withBusy("compare", 3.9);
  };

  const nominalExtCm = Array.from({ length: MAX_POSITION }, (_, i) => nominalExt(i + 1) * 100);
  const noteName = midiToName(midi);
  const fmt = (x, d = 1) => x.toFixed(d);
  const posLabel = (p) => (trigger ? `T${p}` : `${ORDINAL(p)} position`);
  const lowestMidi = trigger ? LOWEST_TRIGGER_MIDI : LOWEST_OPEN_MIDI;

  // An emptied number field parses to 0, which would push NaN through the
  // whole model, so such edits are ignored and the field keeps its last value.
  const setPositive = (set) => (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v) && v > 0) set(v);
  };

  const inOut = (cm) => (Math.abs(cm) < 0.05 ? "exactly on the mark" : `${fmt(Math.abs(cm))} cm ${cm > 0 ? "out" : "in"}`);

  const rowStyle = (c) => ({
    background: c === chosen ? COLORS.panel : "transparent",
    borderLeft: `3px solid ${c === chosen ? COLORS.brass : "transparent"}`,
    // divide-y draws the rule on each row, so its colour has to be set here;
    // a border colour on the list container never reaches the rows.
    borderBottomColor: COLORS.panel,
    opacity: c.reachable ? 1 : 0.6,
  });

  return (
    <div
      className="min-h-screen w-full px-5 py-6"
      style={{ background: COLORS.bg, color: COLORS.ink, fontFamily: "Georgia, 'Times New Roman', serif", fontVariantNumeric: "tabular-nums" }}
    >
      <div className="mx-auto max-w-4xl">
        <header className="mb-2 flex items-baseline justify-between gap-4">
          <h1 className="text-2xl" style={{ color: COLORS.brass }}>
            Trombone slide finder
          </h1>
          <p className="text-sm" style={{ color: COLORS.muted }}>
            {trigger ? "Bb/F tenor, valve engaged" : "Bb tenor, open horn"} · A4 = {a4} Hz
          </p>
        </header>

        <TromboneSVG
          extCm={chosen ? chosen.ext * 100 : 0}
          nominalExtCm={nominalExtCm}
          candidate={chosen}
          colors={COLORS}
          reachable={chosen?.reachable}
          positionLabel={(p) => (trigger ? `T${p}` : String(p))}
        />

        {/* Headline readout */}
        <div className="mb-6 mt-1 rounded px-4 py-3" style={{ background: COLORS.panel }}>
          {chosen ? (
            <>
              <div className="text-xl">
                <span style={{ color: COLORS.brass }}>{noteName}</span> on the {ORDINAL(chosen.partial)} partial:{" "}
                {posLabel(chosen.position)}, {inOut(chosen.deltaCm)}
                {Math.abs(chosen.deltaCents) >= 0.5 && (
                  <span style={{ color: COLORS.muted }}>
                    {" "}
                    ({chosen.deltaCents > 0 ? "+" : "−"}
                    {fmt(Math.abs(chosen.deltaCents), 0)}¢ vs. equal-tempered position)
                  </span>
                )}
              </div>
              <div className="mt-1 text-sm" style={{ color: chosen.reachable ? COLORS.muted : COLORS.warn }}>
                {chosen.reachable
                  ? `Slide ${fmt(chosen.ext * 100)} cm out from fully closed · ${fmt(fTarget, 1)} Hz`
                  : chosen.ext < 0
                    ? `Needs the slide ${fmt(-chosen.ext * 100)} cm inside 1st position — you'd have to lip it up ${fmt(-chosen.deltaCents, 0)}¢, or pick another partial.`
                    : `Needs ${fmt(chosen.ext * 100)} cm of slide, past the ${maxExtCm} cm you have — at the end of the slide it'd be ${
                        chosen.centsSharpAtMax < 0.5 ? "under 1" : fmt(chosen.centsSharpAtMax, 0)
                      }¢ sharp, so lip it down or pick another partial.`}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={playNote}
                  disabled={playing !== null}
                  className="rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 disabled:opacity-50"
                  style={{ background: COLORS.brass, color: COLORS.bg }}
                >
                  {playing === "note" ? "Playing…" : `Play ${noteName}`}
                </button>
                {Math.abs(chosen.deltaCents) >= 0.5 && (
                  <button
                    onClick={playCompare}
                    disabled={playing !== null}
                    className="rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 disabled:opacity-50"
                    style={{ background: COLORS.bg, color: COLORS.ink, border: `1px solid ${COLORS.muted}` }}
                  >
                    {playing === "compare" ? "Textbook mark → corrected → both…" : "Hear textbook mark vs. corrected"}
                  </button>
                )}
                {Math.abs(chosen.deltaCents) >= 0.5 && (
                  <span className="text-xs" style={{ color: COLORS.muted }}>
                    {fmt(nominalFreq, 1)} Hz at the mark vs. {fmt(fTarget, 1)} Hz in tune
                  </span>
                )}
              </div>
            </>
          ) : (
            <div style={{ color: COLORS.muted }}>No partial puts this note on the slide.</div>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
          {/* Note picker */}
          <section>
            <div className="mx-auto mb-3 max-w-xs">
              <BassStaffSVG midi={midi} colors={COLORS} />
            </div>
            <div className="mb-2 flex items-center gap-3">
              <button
                onClick={() => setMidi((m) => Math.max(lowestMidi, m - 1))}
                className="rounded px-3 py-1 text-lg focus:outline-none focus:ring-2"
                style={{ background: COLORS.panel, color: COLORS.ink }}
                aria-label="Semitone down"
              >
                ▼
              </button>
              <div className="flex-1 text-center text-3xl">{noteName}</div>
              <button
                onClick={() => setMidi((m) => Math.min(HIGHEST_MIDI, m + 1))}
                className="rounded px-3 py-1 text-lg focus:outline-none focus:ring-2"
                style={{ background: COLORS.panel, color: COLORS.ink }}
                aria-label="Semitone up"
              >
                ▲
              </button>
            </div>
            <input
              type="range"
              min={lowestMidi}
              max={HIGHEST_MIDI}
              value={midi}
              onChange={(e) => setMidi(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: COLORS.brass }}
              aria-label="Note"
            />
            <div className="mt-1 flex justify-between text-xs" style={{ color: COLORS.muted }}>
              <span>{midiToName(lowestMidi)}</span>
              <span>{midiToName(HIGHEST_MIDI)}</span>
            </div>

            <div className="mt-5 grid grid-cols-4 gap-1">
              {[Math.floor(midi / 12) * 12 - 12, Math.floor(midi / 12) * 12, Math.floor(midi / 12) * 12 + 12].flatMap((base) =>
                Array.from({ length: 12 }, (_, i) => base + i),
              )
                .filter((m) => m >= lowestMidi && m <= HIGHEST_MIDI)
                .map((m) => (
                  <button
                    key={m}
                    onClick={() => setMidi(m)}
                    className="rounded px-1 py-1 text-sm focus:outline-none focus:ring-2"
                    style={{
                      background: m === midi ? COLORS.brass : COLORS.panel,
                      color: m === midi ? COLORS.bg : COLORS.ink,
                    }}
                  >
                    {midiToName(m)}
                  </button>
                ))}
            </div>
          </section>

          {/* Partial choices */}
          <section>
            <p className="mb-2 text-sm" style={{ color: COLORS.muted }}>
              Every partial that can reach {noteName}. Pick one to see its slide position.
            </p>
            <div className="divide-y">
              {candidates.map((c) => (
                <button
                  key={c.partial}
                  onClick={() => setPartial(c.partial)}
                  className="grid w-full grid-cols-[3.2rem_1fr_auto] items-baseline gap-3 px-3 py-2 text-left focus:outline-none focus:ring-2"
                  style={rowStyle(c)}
                >
                  <span className="text-lg" style={{ color: COLORS.brass }}>
                    {ORDINAL(c.partial)}
                  </span>
                  <span>
                    {posLabel(c.position)}, {inOut(c.deltaCm)}
                    <span className="block text-xs" style={{ color: COLORS.muted }}>
                      partial is {c.openNote} in {trigger ? "T1" : "1st"}
                      {Math.abs(c.deltaCents) >= 0.5 ? ` · ${c.deltaCents > 0 ? "+" : "−"}${fmt(Math.abs(c.deltaCents), 0)}¢` : ""}
                      {!c.reachable && <span style={{ color: COLORS.warn }}> · out of reach</span>}
                    </span>
                  </span>
                  <span style={{ color: COLORS.muted }}>{fmt(c.ext * 100)} cm</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* Explanation */}
        <div className="mt-8">
          <button onClick={() => setShowHow((s) => !s)} className="text-sm underline focus:outline-none" style={{ color: COLORS.muted }}>
            {showHow ? "Hide how this works" : "How this works"}
          </button>
          {showHow && <HowItWorks colors={COLORS} effLength={effLength} />}
        </div>

        {/* Settings */}
        <div className="mt-4">
          <button onClick={() => setShowSettings((s) => !s)} className="text-sm underline focus:outline-none" style={{ color: COLORS.muted }}>
            {showSettings ? "Hide instrument settings" : "Instrument settings"}
          </button>
          {showSettings && (
            <div className="mt-3 grid gap-4 rounded p-4 text-sm sm:grid-cols-2" style={{ background: COLORS.panel }}>
              <label className="flex items-center justify-between gap-3">
                <span>F attachment engaged</span>
                <input
                  type="checkbox"
                  checked={trigger}
                  onChange={(e) => {
                    setTrigger(e.target.checked);
                    // The valve unlocks pedals below E1; drop them again when it's released.
                    if (!e.target.checked) setMidi((m) => Math.max(LOWEST_OPEN_MIDI, m));
                  }}
                  style={{ accentColor: COLORS.brass }}
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>A4 reference (Hz)</span>
                <input type="number" value={a4} min={415} max={466} step={1} onChange={setPositive(setA4)} className="w-20 rounded px-2 py-1" style={{ background: COLORS.bg, color: COLORS.ink }} />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>Effective length in 1st position (m)</span>
                <input type="number" value={effLength} min={2.5} max={3.3} step={0.01} onChange={setPositive(setEffLength)} className="w-20 rounded px-2 py-1" style={{ background: COLORS.bg, color: COLORS.ink }} />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>Maximum slide travel (cm)</span>
                <input type="number" value={maxExtCm} min={50} max={80} step={1} onChange={setPositive(setMaxExtCm)} className="w-20 rounded px-2 py-1" style={{ background: COLORS.bg, color: COLORS.ink }} />
              </label>
              <p className="sm:col-span-2" style={{ color: COLORS.muted }}>
                With these values {trigger ? "T1–T2" : "1st–2nd"} is {fmt(nominalExtCm[1])} cm and {trigger ? "T6" : "7th"} sits at{" "}
                {fmt(nominalExtCm[trigger ? 5 : 6])} cm. See "How this works" for what the effective length means and what the model leaves out.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
