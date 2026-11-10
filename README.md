# Sound System Designer

A desktop app (Windows first) that designs loudspeaker enclosures and whole sound systems from driver specs: sealed,
ported, band-pass and horn-loaded boxes, and 2-way to 4-way systems with crossovers. Work in progress: so far this
repository holds the physics library (milestone A0), a direct-radiator box designer that runs in the browser (A1:
driver entry, sealed/ported/band-pass, response, excursion, impedance and group-delay plots) and a horn designer (A2:
front-loaded horns and rear-loaded scoops; exponential, hyperbolic, tractrix and conical flares; a one-dimensional
horn simulation; a profile drawing and a panel table for horns built from straight panels) and a system view (A3,
up to four bands behind Linkwitz-Riley crossovers, trim, delay and polarity per band, drivers and wiring, an amp
per band with load, power and excursion limits and a max-level table, the summed response in dB SPL, generic
starting points) and a Build page (A4: wall material and sheet size, box shape and bracing per band, a cut list, baffle drawings, sheet layouts and a bill of materials, metric). Exports and the desktop shell come next.

The horn simulation is one-dimensional (plane waves) and lossless. It shows cutoff, mouth-reflection ripple and how
the horn loads the driver. Its response is radiated power: it does not know about directivity or bends.

Sibling of the [Sound System](https://github.com/spinsycle/soundsystem) VST3 plugin. The two are independent products
that implement one shared physics spec and assert the same test vectors.

Generic parts only: the driver classes are invented values, not products. No brand, driver-model or named
sound-system claims.

## Layout

```
packages/physics/     pure TypeScript, no UI, no runtime dependencies
  src/                drivers, sealed, ported, bandpass, horn (lumped bin), hornsim (flares and the horn
                      simulation), power, crossover, box, impedance, system, room
  test/               vectors.test.ts       the shared spec vectors (test-vectors.json)
                      parity.test.ts        numbers computed by the plugin's own C++ (parity.jsonl)
                      closed-forms.test.ts  what neither of those reaches
packages/app/         the designer: Vite + React, plots as plain SVG
  src/model.ts        one box or horn design and everything derived from it (pure, tested against the shared vectors)
  src/system.ts       the whole system: bands, crossovers, levels, starting points (pure, tested the same way)
  src/Chart.tsx       one log-frequency SVG chart
  src/BoxDesigner.tsx, src/SystemView.tsx, src/App.tsx   the pages and the shell that stores the project
tools/
  sync-vectors.mjs    copies test-vectors.json from the spec folder
  parity_dump.cpp     evaluates the plugin's headers; parity-dump.ps1 builds and runs it
  mutation-check.mjs  breaks each formula in turn and requires the gate to fail
```

## Commands

```
npm install
npm run dev         the designer in a browser, with live reload
npm run gate        type check + tests + production build
npm run mutation    mutation check (over ten minutes for the full list; do not run while `npm run dev` is open)
                    npm run mutation -- hornsim model   only the mutations in files whose path contains a word
npm run sync-vectors
```

## Conventions

- SI units inside the library (c = 343 m/s, rho = 1.18 kg/m3). User-facing units (litres, cm2, mm) appear only in
  `BoxParams` and `CustomDriverFields`, named with their unit.
- Everything is evaluated in the frequency domain. Functions that take an optional `sampleRate` give the ideal
  analog curve without it and follow the plugin's digital filters with it.
- Models are lossless Thiele-Small (no box or port losses). The horn is a lumped bin: cutoff, damping and
  sensitivity, no mouth reflections.
- `test-vectors.json` and `parity.jsonl` are generated. Never hand-edit them. A formula change starts in the spec's
  `reference_vectors.py`.

## Licence

AGPL-3.0-only. See `LICENSE`.
