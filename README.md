# Eyewall

A browser game: drive a yacht through real hurricanes, reconstructed from NOAA data.
Working prototype of the opening, the dive from space and Hurricane Katrina at peak.

- `docs/BRIEF.md` is the project brief.
- `HANDOFF.md` describes what exists, what is verified, and what is left.

Build: `npm install && node build.mjs`, then open `dist/index.html`.

Storm conditions are reconstructions from NOAA measurements using parametric wind and wave
models. They are not recordings.

Satellite imagery: NASA MODIS (Terra/Aqua) via NASA Worldview Snapshots / GIBS.
