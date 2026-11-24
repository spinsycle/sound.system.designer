# Changelog

Each release is tagged `good-<date>-v<version>` in this repository.

## 1.15.0 (2026-11-23)

- **Home speaker shapes:** the Build section of the home speaker page has a **Shape** (Rectangular, Trapezoid, Tapered tower) and **Narrow end over wide end**. The baffle is the wide end, so it keeps the width and height set above and the depth follows from the air (drivers, ports and braces taken out). The cut list, drawings, lining, 3D view and bracing are the PA page's. It needs one chamber (no partitions), one column of drivers, a baffle facing front and the ports under the drivers; anything else is built rectangular with a warning saying why. A tower warns when a hole reaches the leaning wall at its narrow top. Speaker templates keep the chosen shape.
- Project file version stays 4; old files open as rectangular (a new optional shape and taper on the speaker).
- Test: the slow vented-box solver test has a 30 s limit (it timed out under load).

## 1.14.1 (2026-11-23)

- **Tapered boxes get bracing:** the Bracing setting now works on a trapezoid and a tapered tower. Each brace is a frame across the interior (a window of bars cut out) evenly spaced from front to back; the cut list has a frame per brace of a trapezoid, or a trapezoid frame repeated for a tower; the wood is taken out of the air so the net volume still holds. The 3D preview shows them (when see-through or exploded) with their windows.
- **Fix: a tower's baffle in 3D** now has the driver and port cut-outs through it, as the rectangular and trapezoid boxes do.
- **Fix: the Shape control on the Build page** is stacked (label above the box) like the other long lists, so its text no longer runs past the edge of the band's card and pushes the card's labels out of view.
- **Fix: the exploded 3D view** now moves every wall of a tapered box, a car wedge and a TQWT column away from the centre of the cabinet. The angled walls were drawn as prisms that did not take part in the explode, so only the flat walls moved.

## 1.14.0 (2026-11-23)

- **Tapered boxes:** a PA band's box on the Build page can be a **trapezoid** (the side walls angle in over the depth: wide front, narrow back) or a **tapered tower** (they lean in over the height: wide bottom, narrow top), with a taper from 0.3 to 1 (narrow end over wide end). The air of the design is held exactly. The cut list has the panels of the shape: trapezoid top and bottom (or front and back), angled or leaning sides cut to their slant length with the bevel angle in the note, and the parallel edges of every trapezoid. A tower's baffle is drawn as a trapezoid; every trapezoid panel is drawn to scale with the length of its edges and can be downloaded as SVG. The 3D preview shows the walls, holes and drivers.
- Sealed, ported and passive-radiator boxes with one driver facing front; anything else (a band-pass box, a horn, several drivers, push-pull, columns, a baffle facing down) is built rectangular with a warning saying why. A hole that reaches the leaning wall at the narrow top of a tower is warned about.
- The sheet layout lists an angled panel by its bounding rectangle, as the wedge and horn sides are. Home speaker and car pages are unchanged.
- Project file version stays 4; old files open as rectangular boxes (a new optional shape and taper per band).

## 1.13.0 (2026-11-23)

- **Compare crossovers:** on the Crossover page, the same drivers and crossover points through up to four variants of network (active or passive), alignment (Butterworth, Linkwitz-Riley, Bessel, Chebyshev) and order (1 to 8, each 6 dB per octave; passive up to 4), drawn over the current one: summed level, phase and group delay, and the amplifier's impedance when the page is passive. Presets: orders 1 to 4, every alignment at this order, active against passive. A combination that cannot be built is refused with the reason.
- **The table:** sum flatness (dB rms over the crossover region), how far the filters alone sum from 0 dB within an octave of a crossover, whether the upper driver must be reversed, peak group delay, filter stages (active) or parts (passive), passband loss, the lowest amplifier load, the hottest part, warnings. A passive variant that cannot be built shows its reason. **Use this** makes a variant the crossover on the page.
- Project file version stays 4; nothing new is stored.

## 1.12.0 (2026-11-23)

- **Compare box types:** on the box page (not for a horn), the same driver in sealed, ported, passive-radiator, band-pass, 6th- and 8th-order band-pass, transmission-line and TQWT boxes drawn over this one: response, cone excursion with the Xmax line, impedance and group delay, and a table (air, tuning, the -3 dB edges, ripple, peak cone excursion and its share of Xmax, peak group delay, warnings). **Cookbook alignment** sizes each box for the driver (sealed for Qtc 0.707, ported on QB3 at QL 7, the passive-radiator and band-pass designs); **Same air** only changes the type. **Use this** makes a candidate the design.
- **Find drivers for this box:** every usable driver in the database and the generic classes, put in this box (box, tuning, port and chosen power kept) and ranked 0 to 100: 40 % reaching the wanted -3 dB point (full marks at or below it, none at twice it), 30 % a flat passband (full to 1 dB of ripple, none at 6 dB), 30 % staying inside Xmax (none at twice Xmax), 10 off per warning (at most 30). Filter by kind and favourites, Show draws a driver over the current response, **Use** puts it in the box.
- The alignment solvers are slow (up to a second each), so their answers are kept while you change the box.
- Project file version stays 4; no new stored fields.

## 1.11.1 (2026-11-23)

- **Car front speakers on the database:** the woofer, coaxial and tweeter pickers on the car page list your favourites and your database drivers (by kind: woofer, midrange or full-range; coaxial; tweeter) beside the generic classes. A database driver uses its own **cut-out** (width or diameter, and height for an oval) and **mounting depth**, new optional fields on a driver (form, CSV columns `cutout_mm`, `cutout_h_mm`, `depth_mm`); without them both are guessed from the cone and a warning says so. The opening follows the cut-out, and the adapter ring, bill of materials, response checks and the crossover import carry the driver. Choosing a generic class drops a database driver.
- Project file version stays 4.

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
