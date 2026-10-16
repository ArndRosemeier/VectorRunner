# Vector Runner

A low-poly 3D world at dusk where every polygon is outlined and glowing, built on the
concept of ProcMuse's **Dusk ride** scene (wireframe mountains, palms, a mirror-smooth road,
a hot horizon glow). TypeScript + Three.js + Vite.

## The world

- **City**: an 8 × 8 grid of blocks with towers, setbacks, prisms and spires, lit windows,
  street dashes, lamps, a plaza with a floating crystal monument, parks, people and traffic.
- **Landscape**: rolling hills, a pine forest in the north, leafy trees and boulders, a
  mountain ring, a mirror lake in the west, deer herds and bird flocks.
- **Loop road**: a racing road out east through a valley between the mountains, lined with
  palms, with streaking lane dashes, edge lines and traffic. Ride it on the motorbike.
- **Caves**: two sinkholes in the southern hills drop into a cave system (a crystal cavern,
  a side grotto and a pool cavern with glow worms), with bats and crawlers. Hold jump in a
  sinkhole's shaft to ride the updraft back up.
- **Sky**: a faceted low-poly sun with turning rings, stars and the dusk glow.

## Two looks

- **Colored**: every kind of thing has its own neon hue.
- **Uni**: the whole world in one hue (blue by default, any colour via the picker).

Switch with the panel or **V**; **B** cycles the uni hue. The choice is remembered.

## Controls

| Key | |
| --- | --- |
| WASD / arrows | move (ride: throttle and lane) |
| Mouse | look (click the view to capture the mouse, or drag) |
| Shift | sprint / fast flight |
| Space | jump, rise in a sinkhole updraft, fly up |
| Q | fly down |
| F | toggle flying |
| R | toggle riding the loop road |
| V / B | uni ↔ colored / next uni hue |
| 1–9 | jump to a place |
| H | hide the panel |

Touch: the left half of the screen is a move stick, the right half looks, a quick tap jumps.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Pushes to `main` build and deploy to GitHub Pages through `.github/workflows/pages.yml`
(enable Pages with "GitHub Actions" as the source in the repository settings).

## How it works

- `src/glow.ts`: the shared look. Geometry is unindexed and carries per-vertex distances to
  each triangle edge (`edge` attribute), so the fragment shader draws antialiased glowing
  edges at a constant pixel width with no screen-space derivatives. Edges between coplanar
  triangles are hidden, so boxes read as boxes; terrain, rocks and caves keep every edge.
  A bloom pass makes the edges glow.
- `src/style.ts`: every material is created per category; switching the look recolours them.
- `src/terrain.ts`: the 4 km heightfield, the road loop, lake basin and sinkhole holes.
- `src/caves.ts`: the caves as a signed distance field, meshed with surface nets; the same
  field is the walking collision.
- `src/city.ts`, `src/nature.ts`, `src/creatures.ts`, `src/sky.ts`, `src/player.ts`.
