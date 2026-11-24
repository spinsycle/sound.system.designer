# Sound System Designer 1.18.0

Windows desktop app (also runs in a browser) for designing loudspeaker enclosures, whole PA systems, home speakers, car installs and crossovers from real driver numbers. This release rolls up everything since 1.10.0.

**Download:** `Sound System Designer_1.18.0_x64-setup.exe` (3.2 MiB, per-user installer, unsigned: if SmartScreen warns, choose More info, then Run anyway).
SHA-256: `21feddb5242ce891b6e328e138a8be7f6a2751d1ce8301c283e5621cf93f2eaf`

## What is new since 1.10.0

### Driver database (1.11)
- A **Drivers** page: search, filters, sort, green favourites, and a form with every Thiele-Small number plus manufacturer, series and model. Import CSV, Driver Probe files or whole libraries.
- One driver picker on the box, home speaker and car pages, with **Use in design** everywhere. Designs keep a copy of the driver they use.
- Car front speakers (woofer, coaxial, tweeter) take database drivers, with cut-out and mounting depth stored on the driver (1.11.1).

### Compare and rank (1.12, 1.13)
- **Compare box types:** the same driver in sealed, ported, passive-radiator, band-pass, 6th- and 8th-order band-pass, transmission-line and TQWT boxes drawn over the current one, with a table of edges, ripple, excursion against Xmax, group delay and warnings.
- **Find drivers for this box:** every usable database driver ranked 0 to 100 for the current box, with the figures behind the score.
- **Compare crossovers:** your drivers and crossover points through other orders, other alignments, or active against passive, with sum flatness, polarity, group delay, parts, passband loss, amplifier load and the hottest part.

### Tapered boxes and wood-saving nesting (1.14 to 1.18)
- **Trapezoid and tapered tower** shapes for PA band boxes (1.14) and home speakers (1.15), with the air held exactly, angled panels, bevel angles, trapezoid drawings, 3D view and bracing.
- Home speaker shapes take **chamber partitions** and **rear or side ports** (1.17).
- **True-outline nesting** (1.16, 1.18): trapezoid panels, car wedge sides and horn section sides are drawn with their real outline on the sheet layout (screen, SVG, DXF) and paired head to tail, with the waste figure counted from true areas.
- Fixes in 1.14.1: the exploded 3D view moves every wall of tapered boxes, wedges and TQWT columns; the tower baffle shows its cut-outs in 3D; the Shape control fits its card.

## Compatibility
- Project files are version 4. Older files open unchanged.
- Parameter and physics results for existing designs are unchanged.

## Known limits
- Several columns of drivers and a baffle facing down still build rectangular, with a warning.
- Every number is a calculated estimate from a simplified model, not a measurement. See the disclaimer in the README.
- Windows installer is unsigned. Not run on a clean PC by the author before release.

Full history: [CHANGELOG.md](../CHANGELOG.md). User Guide: [PDF](User-Guide.pdf).
