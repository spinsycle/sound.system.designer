# Sound System Designer

A desktop app (Windows first) that designs loudspeaker enclosures and whole sound systems from driver specs: sealed,
ported, band-pass and horn-loaded boxes, and 2-way to 4-way systems with crossovers. Work in progress: so far this
repository holds the physics library (milestone A0) and a direct-radiator box designer that runs in the browser (A1:
driver entry, sealed/ported/band-pass, response, excursion, impedance and group-delay plots). The horn designer, whole
systems, cut lists, exports and the desktop shell come next.

Sibling of the [Sound System](https://github.com/spinsycle/soundsystem) VST3 plugin. The two are independent products
that implement one shared physics spec and assert the same test vectors.

Generic parts only: the driver classes are invented values, not products. No brand, driver-model or named
sound-system claims.

## Layout

```
packages/physics/     pure TypeScript, no UI, no runtime dependencies
  src/                drivers, sealed, ported, bandpass, horn, power, crossover, box, system, room
  test/               vectors.test.ts       the shared spec vectors (test-vectors.json)
                      parity.test.ts        numbers computed by the plugin's own C++ (parity.jsonl)
                      closed-forms.test.ts  what neither of those reaches
packages/app/         the designer: Vite + React, plots as plain SVG
  src/model.ts        the design and everything derived from it (pure, tested against the shared vectors)
  src/Chart.tsx       one log-frequency SVG chart
  src/App.tsx         the page
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
npm run mutation    mutation check (several minutes; do not run while `npm run dev` is open)
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
