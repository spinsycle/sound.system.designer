# Tapered boxes: trapezoid and tower

![A tapered tower in 3D](screenshots/tapered-tower.png)

On the Build page each band of a PA system has a **Shape**:

- **Rectangular**: the box as before.
- **Trapezoid: wide front, narrow back**: the side walls angle in over the depth, like a stage monitor or a PA cabinet seen from above.
- **Tapered tower: wide bottom, narrow top**: the side walls lean in over the height.

**Narrow end over wide end** sets the taper: 1 is a plain box, 0.3 is very tapered. The interior proportions (width, height, depth) are for the wide end, and the air of the design is held exactly: a tapered box is bigger than the rectangle with the same proportions, because it has less volume per size.

![Cut list of a trapezoid box](screenshots/tapered-cutlist.png)

## The cut list

- **Trapezoid:** a rectangular front (the wide end) and back (the narrow end), two trapezoid panels for the top and bottom, and two angled sides.
- **Tower:** a trapezoid front and back, a wide bottom, a narrow top and two leaning sides.
- Every angled side is cut to its **slant length** with its ends **bevelled** to the angle in the note. A trapezoid is listed by its bounding rectangle, and the note gives its two parallel edges.
- The **Baffles** section draws a tower's baffle as a trapezoid, and each trapezoid panel to scale with the length of every edge, with a download (SVG).
- The sizes are for butt joints. Test-fit the angled cuts before cutting every panel.

## What it applies to

Sealed, ported and passive-radiator boxes with one driver facing front in the default layout. A band-pass box, a horn, several drivers in a box, push-pull, columns or a baffle facing down is built rectangular, and a warning says why. Braces are built in as for a rectangular box (frames across the interior, evenly spaced from the front to the back; a plan trapezoid's are as wide as the interior where they sit, a tower's are trapezoids; the wood is taken out of the air). On a tower the baffle is narrow at the top: a hole that would come within the margin of the leaning wall at its upper edge is warned about.

The sheet layout lists an angled panel by its bounding rectangle (a trapezoid wastes the corners), as the wedge and horn sides are. The home speaker and car pages are not changed.
