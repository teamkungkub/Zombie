# NIGHTFALL

A first-person zombie survival game built with Next.js, React, Three.js and Web Audio. The scene, weapon, zombies and textures are procedural; no external model or audio downloads are needed during gameplay. Graphics are stylized 3D rather than photorealistic assets.

Run `npm install`, then `npm run dev` and open http://localhost:3000. Build with `npm run build` and serve with `npm start`. Use a WebGL-capable browser. A keyboard and mouse provide the intended experience; touch controls are included.

## Playing with friends

Choose **เล่นกับเพื่อน**, pick Vanguard, Wraith, or Ember, and create a room. Give the six-digit code to friends on the same game URL. The room holds up to four players. The host starts the run, and anyone can reach the green checkpoint and lead the team into the next zone. Everyone sees grenades thrown in their zone and plays the blast from the shared room timer. Shots and grenades can damage teammates within reach. Solid cover blocks both.

The game retries automatically after a network interruption and uses the same room code and session. The host can replay after game over without asking friends to join again. A host who clicks **ออกจากห้อง** closes the room. A room is eligible for cleanup after seven days without activity from any member.

To play over a local network, run `npm run build` and `npm start -- --hostname 0.0.0.0`, then open the same host address on each device. The Node.js server stores rooms in `.nightfall-rooms/`, so a process restart retains them. Use one Node.js process for this file-backed setup.

### Using Supabase for online rooms

1. Open the Supabase project's **SQL Editor** and run [the room migration](../supabase/migrations/202611210001_nightfall_rooms.sql) once. Keep the project's Data API enabled.
2. From the Supabase dashboard, copy the **Project URL** and a **Secret key** (starts with `sb_secret_`). In Vercel **Settings → Environment Variables**, set the following for the environment you deploy. For a local trial, set the same variables in `.env.local` and restart the dev server.

   ```dotenv
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_your_key
   ```

3. Redeploy, then create a fresh room and join it from a second browser. Rooms created with local files or Redis do not transfer to the new store. Keep the secret server-side and out of Git.

The existing Redis setup also works. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` and `KV_REST_API_TOKEN`) without the Supabase variables to use Redis. A temporary storage outage returns a retryable error.

## Controls

WASD moves, mouse looks, left click uses the held item, right click aims, R reloads, Q cycles through available equipment, G selects the grenade, Space jumps, and Esc/P pauses. Tap either Shift key for a short burst or hold it while moving forward to sprint. If the browser prevents pointer locking, drag the mouse over the scene to look. Touch devices can use the item selector and the same press-and-release gesture on the action button.

Clear the wave and defeat the boss before the green checkpoint appears. Reach the checkpoint within 25 seconds to open the exit, then walk through the doorway to enter the next arena. Four zones rotate in order: the quarantine yard, rail depot, foundry, and conservatory. On later visits, some cover shifts. The game sets a finite ammo allowance at each stage start based on the roster and difficulty, and carries over unused rounds. Brutes, fast hunters and armored tanks appear as difficulty rises.

Walk over drops to store supplies. Select a grenade and hold left click for a longer throw, then release. Select the healing injector and click to use it. The 1.5-second animation restores 35 health when it completes. Select the energy drink and click to open the can and drink. The 10-second boost begins once the 1.8-second animation finishes. Personal best eliminations are stored locally when available.

The right hand stays on the grip while the left hand removes and seats magazines. The shotgun reload shows the left hand picking up and inserting each shell. It adds one shell every 0.58 seconds and finishes when full or out of reserve shells. Shooting resumes once reloading finishes. The marksman rifle has an illuminated scoped view. Shots produce a brief flash and drifting smoke at the muzzle, plus a casing that spins out of the receiver. The sidearm settles the fastest and the shotgun kicks hardest. On Survivor difficulty, runners first appear in stage 2, fliers in stage 3, and projectile-spitting enemies in stage 4.

Close-range zombies telegraph their attacks. Brutes raise both arms before slamming a wide area in front of them. Hunters crouch before pouncing along a locked path, which stops at cover. Tanks turn a shoulder to shove, fliers lift their wings before diving, ordinary zombies wind up a claw swipe, and spitters bite at close range. Step back from the slam and sidestep the pounce. Ground enemies' footsteps pan left or right and grow louder as they get closer.

Ordinary zombies limp, brutes swing their shoulders and plant heavy steps, armored tanks take short stiff steps, and hunters lean forward with long, fast strides. Spitters shuffle hunched over, while fliers draw their legs up. Ground footsteps follow the actual distance traveled.

Concrete hits kick up dust with a dull impact, while steel hits throw sparks and ring. Marks cling to the surface for up to nine seconds and fade over the last three.

Hold a movement direction and tap Alt to dodge, or press the dodge button while steering with the mobile joystick. A dodge costs 14 stamina, stays on the ground and stops at solid cover. Damage still depends on whether the player is inside an attack when it lands.

Press V or tap the knife button to slash the nearest zombie within reach in front of you. Each swing costs 9 stamina and works with an empty gun. A sharp swish signals a miss, and a short thud signals a hit. A surviving regular zombie staggers for 0.26 seconds, breaks off its current windup and steps back until it meets solid cover. Boss attacks keep their timing.

## Validation

Each zone has a blue equipment case near the entrance. Collect the sidearm in the quarantine yard, shotgun in the rail depot, light machine gun in the foundry, and marksman rifle in the conservatory. Walk over the case to collect the weapon, then press 1–5 or tap the weapon bar to switch. Each weapon retains its own loaded and reserve rounds. On a later visit, the case gives a limited refill for that weapon. Switching cancels an unfinished reload.

`npm test` checks damage, ammunition conservation, bounded wave scaling, solid cover/boundary collision, and navigating around containers. `npx tsc --noEmit` checks types. `npx eslint app/page.tsx app/layout.tsx components/nightfall lib/nightfall` checks the game code. The existing unrelated `components/Navbar.tsx` uses a plain anchor for `/`, which the full-repository Next.js lint rule flags.
