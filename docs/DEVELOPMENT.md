# Developer notes

## Stack

Vite 8, React 19, Tailwind 4 (via `@tailwindcss/vite`). No routing, no state
library, no backend. The whole app is one file, `src/App.jsx`, in four
blocks:

| Block       | What lives there                                                    |
|-------------|---------------------------------------------------------------------|
| Acoustics   | Note/frequency helpers, `analyseNote()`, the model constants        |
| Audio       | Lazy `AudioContext`, brass `PeriodicWave`, `playTone()`             |
| Drawing     | `TromboneSVG`, `BassStaffSVG`, `HowItWorks`                         |
| App         | State, derived values, layout                                       |

If the file grows much further, split along those lines.

## The model in one place

    fOpen(n)          = n · f(Bb1)                      partial n, slide closed
    centsBelowOpen    = 1200 · log2(fOpen / fTarget)
    lengthRatio       = fOpen / fTarget                  = 2^(centsBelowOpen/1200)
    extension         = L0 · (lengthRatio − 1) / 2       half: the slide is a U
    nominalPosition   = round(centsBelowOpen / 100) + 1
    deltaCents        = centsBelowOpen − 100 · (position − 1)
    deltaCm           = extension − nominalExt(position)

With the F attachment, `f(Bb1)` becomes `f(F1)` and `L0` is multiplied by
`2^(5/12)` — the same factor, so the map just stretches.

Sign convention: positive `deltaCents`/`deltaCm` means *further out* than the
equal-tempered mark. A negative extension means the note would need the slide
inside 1st position; it's listed but flagged unreachable, because that
information ("lip it up 14¢ or use another partial") is the point of the app.

### Constants worth knowing

| Constant               | Value  | Why                                                                  |
|------------------------|--------|----------------------------------------------------------------------|
| `BB_FUNDAMENTAL_MIDI`  | 34     | Bb1. MIDI 46 is Bb2 — an easy octave slip that halves every partial. |
| `F_FUNDAMENTAL_MIDI`   | 29     | F1, same octave as above.                                             |
| `effLength` (default)  | 2.94 m | Acoustic length = c / (2·58.27 Hz). Puts 7th at ≈61 cm.               |
| `maxExtCm` (default)   | 65     | A little past 7th; T6 (≈65.7 cm) is deliberately just out of reach.   |
| `MAX_PARTIAL`          | 12     | F5. Higher partials are playable but rarely used on tenor.            |
| `LOWEST/HIGHEST_MIDI`  | 28/77  | E1 (7th-position pedal) to F5 (12th partial in 1st).                  |

Sanity check after any change to the acoustics: D4 should list the 5th
partial at −14¢ (1.2 cm inside 1st, unreachable), the 6th at 4th position
+2¢, and the 7th at 7th position −31¢. G4 on the 7th partial should be a 2nd
position 2.6 cm in.

## Drawing conventions

`TromboneSVG` is a side-view schematic, not to scale in the vertical. The
horizontal scale is `PX_PER_CM = 4.4`. The position ruler is anchored at
`CROOK_TIP_CLOSED = 434`, the x of the outer-slide crook when fully in; every
marker is `434 + extension · 4.4`. The outer slide group is translated by the
same amount so the crook and the ruler marker stay aligned by construction.
The bell is drawn above the slide so an extended slide passes under it, as on
the real instrument.

`BassStaffSVG` places notes diatonically by letter, so Db and D share a line
and only the ♭ differs. The bottom line is G2 (`BOTTOM_LINE_STEP = 18`, with
steps counted as `octave·7 + letterIndex`). Ledger lines are generated for
any note outside the staff. The clef is a hand-drawn path, not a font glyph,
so it renders the same everywhere.

## Audio

Native Web Audio, no library. Timbre comes from a `PeriodicWave` with 13
harmonics at `1/n^1.25`, harmonics 2–5 boosted ×1.4, through a low-pass whose
cutoff tracks pitch (`min(6000, 6·f)`). It sounds like synth brass; going
further means samples (Philharmonia or VSCO 2 CE both have free trombone
sets) and a few MB of assets.

The `AudioContext` is created inside the first click handler because
browsers — Safari most strictly — refuse to start audio without a user
gesture. `getAudio()` also resumes a suspended context, which happens when
the page is backgrounded.

The compare button plays the textbook-mark pitch, then the corrected pitch,
then both together. The overlap is the useful part: 14¢ on D4 is ~2.3 Hz,
easier to hear as beating than as a pitch difference.

## Deployment

Vite `base` is `/trombone/` and the build goes to `dist/trombone/`, so the
`dist/` layout matches the URL layout both on the site's own
`*.netlify.app` host and when proxied from `mikemc.cc/trombone`. The SPA
fallback in `netlify.toml` is scoped to that prefix. See the commit
"Serve under /trombone/ for proxying from mikemc.cc" for why there's
deliberately no redirect from the bare `/trombone` path.

Netlify reads the build command and publish directory from `netlify.toml`;
nothing is configured in the Netlify UI.

## Lint

`npm run lint` runs oxlint. The current warnings are all `react-hooks/
exhaustive-deps` on the `useMemo` in `App`, where the dependency list is
spelled out on purpose (the `params` object is rebuilt every render).
