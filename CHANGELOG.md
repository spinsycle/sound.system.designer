# Changelog

Each release is tagged `good-<date>-v<version>` in this repository.

## Unreleased (after 1.9.0)

- **Driver Probe page and driver library:** measure a driver with the Driver Probe rig over USB or WiFi, live impedance curve and Thiele-Small fit, added-mass method, save to a library, export and import `.driver.json`, Use in design. See [docs/driver-probe.md](docs/driver-probe.md).
- **Datasheet import:** bulk-import drivers from a CSV, with derived Q values and consistency checks, and a downloadable template.
- **Home speaker port position:** put the port under the drivers, beside the top or lowest driver (left or right), or on the back wall, with offsets; it moves the hole in the cut list, baffle drawing and 3D view only.
- Documentation: README, [box types](docs/box-types.md), User Guide, and all screenshots refreshed.

## 1.9.0 (2026-11-19)

6th-order and 8th-order band-pass, TQWT, level readouts on every box, transmission line cut as a real folded box, the new types on the car and speaker pages and in the Brief. Shared spec v0.19 (273 vectors).

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
