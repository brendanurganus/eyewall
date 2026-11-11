HOW TO WORK WITH ME: Work in the stages listed under "Build order." At the end of each stage, STOP and do not start the next stage until I explicitly say "go" (or similar). Each time you stop, tell me in plain language:
1. What you built or found in this stage, and show it (screenshot or published link) if it's visual.
2. Any problems, compromises or data gaps, and how you handled them.
3. Any decisions I need to make before the next stage.
4. What the next stage will involve and anything risky about it.
Keep these updates short and clear. If you hit a serious problem mid-stage (data missing, visuals not working), stop early and tell me instead of pushing through. Within a stage, work independently and don't ask me about small choices.

# Eyewall (working name)

A browser-based, photoreal ocean game: drive a luxury yacht through real hurricanes, rebuilt from NOAA data. Visual realism is the top priority, and every data source must be public domain.

## Core experience
1. Main view: a real-time 3D globe showing every storm NOAA is tracking RIGHT NOW (Atlantic, Eastern Pacific, Central Pacific), plus a browsable archive of every storm since 2005 in those basins.
2. Select a storm: its full track appears on the globe, colored by Saffir-Simpson category at each point.
3. Choose where on the path to start (e.g., Katrina near Florida as a Cat 1 vs. in the Gulf as a Cat 5). Show category, wind, pressure and date/time at the chosen point.
4. A continuous cinematic dive from space, down through the cloud tops and rain bands into the eyewall, landing behind the yacht.
5. Time moves: the storm travels its real track and changes intensity as you ride. Speed controls (1x, 10x, 60x, 600x). Day/night, sun and moon follow the real date, time and location.

## Gameplay
- Third-person chase camera behind and above the boat, like controlling a player in EA NHL. Smooth, responsive controls: keyboard, gamepad if feasible, touch on phones.
- Boat handling gets harder as wind and waves build. Brutal, not instant death. Keep it playable.
- The player can drive out of the eyewall, into the eye, or out to the rain bands, with conditions changing realistically with distance from the center.

## Live readout (toggle on/off)
Wind speed and direction at the boat, gusts, wave height and period, pressure, distance to storm center, storm category, storm date/time, boat speed and heading.

## Design direction
- PHOTOREAL above all. Physically based ocean, sky, clouds, rain, spray, foam and lighting, aiming for the best a browser can do (WebGPU if available, WebGL fallback). Use every proven real-time technique: FFT/spectral ocean waves driven by wind, whitecaps and wind-aligned foam streaks, subsurface scattering in wave crests, volumetric or high-quality layered clouds, physically based atmosphere and sun, auto-exposure, motion blur, wet surfaces and reflections on the yacht. Lean on darkness, rain and spray where they help realism. If photoreal can't be reached for some element, show me the best attempt and explain the gap before falling back to anything stylized.
- Globe and menus: storm-center / NHC radar ops room aesthetic. Dark, cool blues, with warning reds and oranges reserved for severity. Clean and data-dense.
- Track colors: the National Hurricane Center's standard category colors (verify the exact palette).
- The eye: render whatever is realistic for that storm, intensity and time of day. Don't force one look.
- The yacht: a large, classic luxury motor yacht in the spirit of the one in The Wolf of Wall Street, roughly 45-55 m, white or navy hull, multi-deck superstructure. An original design, not a copy of any real vessel.
- Camera effects: rain and spray droplets on the lens, camera shake with big waves and gusts, each with a settings toggle.
- No sound.
- Desktop gets the full experience; phones automatically get a lighter version.
- Intro: a photoreal shore scene. Open tight on a single palm tree on a calm beach at dusk. Over ~10 seconds the storm arrives: wind builds, fronds whip, the trunk bends, waves grow and crash on the shore, rain blows sideways, the sky darkens. The camera rises straight up through the rain and cloud tops into space, revealing a hurricane from above, and the title "Eyewall" appears inside the eye. The camera pulls back as every storm track since 2005 draws itself in date order, colored by category, landing on the main globe. ~15-20 seconds, skippable, respects reduced motion.

## Data: PUBLIC DOMAIN ONLY
Use only US federal government data (public domain) for all data. Visual assets (textures, sky maps, models) may be public domain or CC0. Check and document the terms of every source; if something isn't public domain or CC0, don't use it and tell me.
1. Storm tracks: NOAA HURDAT2 (Atlantic, and Northeast/North Central Pacific), 2005 onward: 6-hourly position, max wind, min pressure, wind radii.
2. Storm structure (radius of maximum wind, eye size): check whether the Extended Best Track or another source with this is public domain. If not, estimate these from HURDAT2 wind radii using published relationships, and document how.
3. Live storms: NOAA National Hurricane Center and Central Pacific Hurricane Center current data. A published Claude artifact can't fetch live data, so set up a scheduled task to refresh it (every few hours during active storms), the way my OverHead project refreshes its cloud imagery. A GitHub Pages copy may fetch directly if simpler.
4. Wind field: reconstruct with a standard parametric hurricane model (e.g., Holland) fitted to the NOAA values at each time, interpolated between 6-hour points. Do NOT use ERA5 or other non-public-domain reanalysis.
5. Waves: a standard parametric wave model driven by that wind field. Compare against real NOAA NDBC buoy readings wherever a buoy was near the storm, and report how close the model gets.
6. Globe imagery: NASA Blue Marble (public domain). Seafloor/coast shapes if needed: NOAA/USGS data only.
7. Visual assets: CC0 textures, sky maps and models (e.g., ambientCG, Poly Haven), or built from scratch. Credit them anyway.
8. Be explicit in the app and methodology that storm conditions are reconstructions from NOAA measurements, not recordings.

## Respect
Each storm's info panel states its human toll and damage plainly. Frame it as experiencing and understanding these storms' power, not as entertainment at victims' expense.

## Hosting
Claude artifact plus a GitHub Pages copy (I'll provide the repo). Include a methodology page: every data source and its public-domain status, how winds and waves are reconstructed, known limits, and the buoy comparison results.

## Build order
1. Verify data access and licenses; pull and clean HURDAT2 and storm-structure data since 2005; report coverage, gaps and anything that isn't public domain.
2. Photoreal visual prototype: the palm-tree shore intro opening AND Katrina at peak in the Gulf with a drivable yacht, chase cam, lens effects, real wind and wave reconstruction. This is the make-or-break stage. Show me before continuing.
3. Time progression along the track, speed controls, day/night and moon.
4. Globe, storm archive, category-colored tracks, path selector, space-to-storm dive.
5. Live storm data and scheduled refresh.
6. Full intro sequence, readout HUD, settings toggles, phone version, methodology page, buoy comparison, publishing.

Ask me questions whenever a decision is mine to make