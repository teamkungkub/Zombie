# Nightfall implementation plan

**Goal:** Deliver a playable first-person zombie survival game in the existing app.
**Architecture:** Next.js page renders a client game shell. A disposable Three.js engine owns the scene, controls, audio and simulation; React renders menus and throttled HUD snapshots. Pure combat rules have Node tests.
**Tech Stack:** Next.js 16, React 19, TypeScript, Three.js, Web Audio.

- [x] Test combat damage, ammo reload and wave progression rules before implementation.
- [x] Implement a procedural industrial quarantine yard, animated zombies, first-person weapon, collision, aiming, recoil, sound and waves.
- [x] Implement start, settings, instructions, pause, death/restart and mobile controls in a restrained military visual system.
- [x] Run tests, game-scope lint, typecheck and production build. Inspect desktop (1440×900), mobile (390×844), firing, reload, difficulty, settings, guide, enemy damage, death and restart. Full-repository lint retains one pre-existing issue in Navbar.tsx.

Review caught and fixed enemies stalling behind containers and retained joystick input after death. A shared navigation flow field now passes a container regression, and independent simulation reached four player positions from all 27 sampled valid spawns in the actual obstacle layout. Physical mobile multitouch and GPU performance remain unverified.

Preserve existing team route and components. Avoid committing or deploying without a request. Test renderer failures, pointer lock release, tab visibility and resource cleanup as part of review.
