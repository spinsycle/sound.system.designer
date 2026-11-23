# Changelog

Each release is tagged `good-<date>-v<version>` in this repository.

## 1.11.0 (2026-11-23)

- **Driver database:** a Drivers page with your own drivers (manufacturer, series, model, kind, notes and every Thiele-Small number including Le, Mms, Cms, Bl, Rms, sensitivity, Znom and Xmech), search, filters (favourites, ready to use, kind, maker, source, fs, Qts, Vas, cone diameter) and sorting. Favourites are green; generic drivers can be starred too. Missing numbers (third Q, Vas and Cms, Mms, Bl, Rms) are worked out and marked; out-of-range or inconsistent input is refused.
- **Import and export:** CSV with identity and extended columns, Driver Probe files, whole libraries. The old measured-driver library is converted once; the old data is left in place.
- **One driver picker** on the box, home speaker and car pages: favourites, your drivers, generic classes, Custom. A design keeps a copy of the driver, so a project opens without the library; Update from the library re-copies it after an edit. Use in design works for any PA band, home-speaker slot and the car subwoofer.
- The Driver Probe page saves into the database; its own saved-drivers table and CSV importer are gone.
- Project file version 4 (files from 1.10 and earlier open as before; a 1.11 file is refused by older versions).
- Not yet: the car page's front speakers still choose from the generic classes only.

## 1.10.1 (2026-11-21)

- **Small and mini-system drivers:** nine generic classes (2 in and 2.5 in full-range, 5 in mid, 5 in and 6.5 in sub, 0.5 in dome, 0.75 in, 1.4 in and 2 in compression drivers), appended to the class list so saved projects are unchanged.
- **Mini horns:** Mini bass horn, Mini mid horn and Mini HF horn starting points on the Box page.
- **Desktop Jamaican-style stacks:** three PA starting points (mini desktop stack, mini scoop set, micro stack); a starting point can now set the lowest frequency played.

## 1.10.0 (2026-11-21)

- **Crossover:** a fourth mode beside PA system, Home speaker and Car subwoofer. 2, 3 and 4 ways and a subwoofer split; Butterworth, Linkwitz-Riley, Bessel and Chebyshev, orders 1 to 8 (passive up to 4); polarity advice and time alignment.
- **Active circuits:** Sallen-Key (equal-component and unity-gain), multiple-feedback and state-variable stages, with every part value, E24 or E96 snapping and the error it causes.
- **Passive networks:** ladders designed against the driver's real impedance (voice-coil inductance and a resonance, or an imported ZMA file; an FRD file for the response), Zobel, L-pad, a deterministic optimiser that keeps the amplifier above its minimum load, and the volts, amps, heat and capacitor rating of every part.
- **Outputs:** schematic (SVG, or print to PDF), bill of materials and parts list (CSV).
- **Apply to the design:** the alignment, order and frequencies go back into the PA system, the home speaker and the car fronts, with Undo. Those three pages now take any alignment; Linkwitz-Riley 4, the default, gives the same numbers as before.
- Project file version 3 (older files open as before; a 1.10 file is refused by older versions). Shared spec v0.24 (378 vectors).

## 1.9.1 (2026-11-19)

- **Datasheet import:** bulk-import drivers from a CSV, with derived Q values and consistency checks, and a downloadable template.
- **Home speaker port position:** put the port under the drivers, beside the top or lowest driver (left or right), or on the back wall, with offsets; it moves the hole in the cut list, baffle drawing and 3D view only.
- Documentation: README, CHANGELOG, [box types](docs/box-types.md), User Guide, and all screenshots refreshed.

## 1.9.0 (2026-11-19)

6th-order and 8th-order band-pass, TQWT, level readouts on every box, transmission line cut as a real folded box, the new types on the car and speaker pages and in the Brief. Also in 1.9.0: the **Driver Probe page and driver library** (measure a driver with the Driver Probe rig over USB or WiFi, live impedance curve and Thiele-Small fit, added-mass method, save, export and import `.driver.json`, Use in design; see [docs/driver-probe.md](docs/driver-probe.md)). Shared spec v0.19 (273 vectors).

## 1.8.0 (2026-11-16)

Loudspeaker Design Cookbook alignment: box losses QL, vented alignments, closed-box Qtc design, fibre fill, efficiency and vent checks, passive radiator and transmission-line box types, cabinet and baffle rules.

## 1.7.0 (2026-11-16)

The scoop bin: a tapered folded horn with sloped septa.

## 1.6.0 (2026-11-16)

Folded horns (stacked legs in one box), the recommended fold, push-pull side by side.

## 1.5.0 (2026-11-16)

Driver layouts (columns, rows, magnet in or out, push-pull, facing down), rectangular ports, drivers in 3D, desktop or browser launcher.

## 1.4.0 (2026-11-11)

The Ollama Brief designs a whole home speaker or a car install.

## 1.3.0 (2026-11-11)

Car audio: subs in a shared box or wedge, amplifier and cabin gain, vehicle space, 12 V checks, front speakers, nine starting points.

## 1.2.0 (2026-11-11)

Home speakers: 2-way, MTM, WTW, TMM, 3-way and 2.5-way with baffle step and a one-cabinet cut list.

## 1.1.0 (2026-11-10)

Inch units on the Build page and in exports; stricter Brief schema.

## 1.0.0 (2026-11-10)

Tauri desktop app and installer, native save and open dialogs, project files, Ollama brief-to-design, 3D preview, SVG and DXF export, cut list and bill of materials, whole-system designer, horn designer, direct-radiator box designer.
