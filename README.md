# Sound System Designer

Design loudspeaker enclosures and whole sound systems from driver specs. Windows desktop app (also runs in a browser).
Version 1.4.0.

**[Download the Windows installer](https://github.com/spinsycle/sound.system.designer/releases/latest)** (unsigned: if
SmartScreen warns, choose More info, then Run anyway). The [User Guide (PDF)](docs/Sound-System-Designer-User-Guide.pdf) covers every page of the app.

- **Boxes and horns:** sealed, ported, band-pass and horn-loaded boxes (front-loaded horns and rear-loaded scoops;
  exponential, hyperbolic, tractrix and conical flares), with response, excursion, impedance and group-delay plots.
- **Systems:** up to four bands behind Linkwitz-Riley crossovers; trim, delay and polarity per band; drivers and wiring; an
  amplifier per band with load, power and excursion limits and a max-level table; the summed response in dB SPL; eight
  generic starting points.
- **Home speakers:** a second mode for one cabinet with several drivers, desktop to floorstanding: 2-way, MTM (D'Appolito),
  WTW, TMM, 3-way and 2.5-way, with dome, planar and woofer classes from 0.75 in to 21 in, a baffle step from the
  baffle width, a crossover between the drivers, and eight starting points. It builds a one-cabinet cut list with the
  drivers placed on the baffle, a shelf between separate woofer chambers and a port per ported driver.
- **Car audio:** a third mode for a car install: one to four subs (single or dual voice coil, series or parallel) in one
  shared box or a wedge, an amplifier (optionally bridged) with its load and limits, the cabin gain of the vehicle, a vehicle
  space with a fit check, the 12 V side (supply current, cable gauge and drop, fuse, alternator), front speakers (a component
  set or a coaxial in a door, kick panel or the dash, with adapter rings), the whole system in one plot, and nine starting points.
- **Build:** wall material and sheet size, box shape and bracing, a cut list, baffle drawings, sheet layouts and a bill of
  materials (millimetres or inches), a 3D preview, SVG and DXF files of the sheet layouts and baffles, and a print layout for PDF.
- **Brief:** describe a system, a box, a home speaker or a car install in words and a local [Ollama](https://ollama.com) model proposes three variants.
  The model only picks parts and sizes into a strictly checked schema; the same calculators as everywhere else judge the
  result. Everything stays on your computer: only an Ollama server on `localhost` is ever contacted.
- **Projects:** Save project and Open project write and read a `.ssd.json` file; the app also remembers your last
  project on its own.

Generic parts only: the driver classes are invented values, not products, and no brand, driver-model or named
sound-system claims are made. Levels and limits are small-signal calculations, not measurements: check anything you
build against real drivers and a real amplifier.

## Install

Run `Sound System Designer_1.4.0_x64-setup.exe` (a per-user installer: no administrator rights, adds a Start menu entry
and a desktop shortcut, and an uninstaller in Settings, Apps). It is not code-signed, so Windows SmartScreen will warn on
the first run: choose More info, Run anyway. It needs the Microsoft WebView2 runtime, which Windows 11 includes.

To use the Brief panel, install Ollama and pull a model once: `ollama pull llama3.1:8b`.

## Use

1. **System** page: pick a starting point or build your own bands; each band's box opens on its own page. For a stereo
   speaker switch to **Home speaker** at the top, pick a starting point and press Load it. For a car, switch to **Car
   subwoofer**, pick a starting point and press Load it.
2. **Build** page: choose Millimetres or Inches, wall material, sheet size (fractions like 3/4 or 1 1/2 work in inches), box proportions and bracing; read the cut list; save SVG, DXF or CSV
   files, or print to PDF.
3. **Brief** (top of every page except Build: PA system, box, Home speaker and Car subwoofer): type what you need, press Design 3 variants, compare the table, Load one.
   Undo last load brings your previous design back.

## Known limits

- The horn simulation is one-dimensional and lossless, half space only: no bends, directivity or losses. The response is
  radiated power.
- Systems use active crossovers, identical drivers per band summed as one source (optimistic for wide arrays), and
  small-signal limits (no power compression or limiter).
- Cut lists use butt joints and rectangular boxes; horn side panels are cut as bounding rectangles; hole sizes and the
  driver's displacement are estimates.
- The sheet layout is a simple heuristic, not an optimal nesting.
- The Brief model is not deterministic and sometimes gives a poor or refused design; the warnings column is the
  calculators judging it.
- Home speakers use an active crossover (no passive parts list), on-axis response only (no vertical lobing between the
  drivers of an MTM, no tweeter beaming or edge diffraction), and build a ported slot with front ports. A project saved by
  1.2 does not open in 1.1 (the file version is 2); 1.1 files open in 1.2.
- Car audio: the cabin gain is a generic rule of thumb per vehicle type, not a measurement of any car; the sub's limits
  are for a steady sine (an amplifier matched to them looks small beside the driver's rating); the front speakers sit in a
  sealed box of the air you give them (a real door leaks); a wedge has no bracing and plain butt joints; no battery sag,
  no time alignment, no rear speakers. A project saved by 1.3 opens in 1.2 as a PA system (the car install is ignored)
  and 1.1 refuses it (file version 2).
- Windows only for now. Lengths on the Build page and in the exported files can be millimetres or inches; the box pages (volumes, areas, port sizes) stay metric.

## Develop

```
npm install
npm run dev         the designer in a browser, with live reload
npm run gate        type check + tests + production build
npm run mutation    breaks each formula in turn and requires the gate to fail (over ten minutes for the full list;
                    npm run mutation -- cabinet brief   only the files whose path contains a word; not while `npm run dev` is open)
npm run sync-vectors
npx tauri build     the Windows installer (needs Rust, stable MSVC); output in src-tauri/target/release/bundle/nsis/
```

Layout:

```
packages/physics/   pure TypeScript, no UI: drivers, sealed, ported, bandpass, horn, hornsim, power, crossover, box,
                    impedance, system, room, level, cabinet; tests assert the shared physics vectors and the plugin's numbers
packages/app/       the designer: Vite + React, plots as plain SVG, three.js for the 3D view
  src/model.ts, system.ts      one design and the whole system (pure)
  src/build.ts, buildlist.ts   cut list, sheets, bill of materials (pure); export.ts, layout3d.ts (pure)
  src/brief.ts, ollama.ts      the Ollama brief: schema, strict validators, prompt, client and runner
  src/briefhome.ts             the same for a home speaker and a car install
  src/projectfile.ts           the project file; desktop.ts is the only place that knows about the desktop shell
src-tauri/          the Tauri v2 shell: window, native Save and Open, and an HTTP client for Ollama
tools/              sync-vectors, parity dump (builds the plugin's C++ headers), mutation-check
```

Conventions: SI units inside the libraries; everything is evaluated in the frequency domain; `test-vectors.json` and
`parity.jsonl` are generated and never hand-edited (a formula change starts in the shared spec's `reference_vectors.py`).
A real-model prompt check: `OLLAMA_EVAL=1 npx vitest run brief-eval`.

Sibling of the Sound System VST3 plugin (not published): two independent products that implement one shared physics spec
and assert the same test vectors. The `sync-vectors` and `parity-dump` tools in `tools/` regenerate test data from that
spec and plugin, which are not part of this repository; the generated files they produce are committed, so
`npm test` runs without either.

## Licence

GNU Affero General Public License, version 3 only (`LICENSE`). Third-party components are listed in
`THIRD-PARTY-NOTICES.md`. If you run a modified version as a network service, the AGPL requires you to offer its source;
the source of this version is this repository.
