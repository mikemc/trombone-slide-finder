# Trombone slide finder

Pick a note and a partial; see where the slide needs to be — and how far in or
out of the textbook position the harmonic series puts it. A bass-clef staff
shows the note, and Web Audio playback lets you hear the pitch at the
equal-tempered mark against the corrected one.

Live at **https://mikemc.cc/trombone/**.

The physics is explained on the site under "How this works". In short: the app
treats the horn as an ideal harmonic series over an effective 1st-position
length of 2.94 m (Bb1 = 58.27 Hz, A4 = 440 Hz), solves for the tube length that
puts a given partial on the target pitch, and halves the added length to get
hand travel. The F attachment multiplies the effective length by 2^(5/12).

## Develop

    npm install
    npm run dev        # http://localhost:5173/trombone/

## Build and deploy

    npm run build      # output in dist/trombone/

The site is built and deployed by Netlify on every push to `main`
(`netlify.toml`). It's served under the `/trombone/` prefix so it can be
proxied from mikemc.cc; see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for
details on the layout, constants, and the reasoning behind a few choices.

## Acknowledgements

The model, component, and initial project scaffold were developed in
conversation with [Claude Fable 5.1](https://www.anthropic.com/claude-fable-and-mythos-5-1)
(Anthropic), September 2026. Physics was checked against well-known partial
offsets (5th-partial D4 ≈ 14¢ flat in 1st position; 7th-partial G4 in a sharp
2nd) before shipping.
