# 🪔 Diwali Globe

A blank night globe, just coastlines, country borders and Indian states, that flies in to your city. Light a diya or burst a cracker: the camera pulls back and your fireworks go off above your city, while bursts from everyone else light up India and the world, live.

**Live:** https://voideepak.github.io/diwali/

- Your city comes from a free IP lookup. Tap **Not right?** to use precise browser location. Only the city name and coordinates rounded to about 10 km are shared.
- Every diya is one small warm dot, and it stays lit for everyone who visits. The map starts dark and fills in as people light diyas, so busy cities glow like cities at night. The **Brightest cities** leaderboard ranks them live; click a city to fly there.
- Crackers whistle as the rocket climbs, then boom, timed so the bang lands exactly when the shell bursts on screen. Your own crackers are loud; other people's are softer and farther away.
- Use **My city / India / World** to jump between your city, India and the whole world. Hover or tap a diya to read the wishes from that city.
- Private room for family or friends: add `?c=<room-name>` to the link.
- Static site on GitHub Pages: no server, no accounts, no cost. Events are small signed messages on free, open [Nostr](https://nostr.com) relays.

## How it keeps up with a crowd

- **Diyas** are stored by the relays. On load, the page pages back through all of them, 500 at a time, so the map and leaderboard count every diya.
- **Crackers** are ephemeral: relays pass them to whoever is watching but never store them, so a flood of crackers can't push diyas out of history. Each person also keeps one replaceable "tally" message with their running cracker count per city, so totals survive without storing every cracker.
- Each browser writes to all 5 relays but listens to only 3, chosen at random, which spreads the load.
- Every incoming message's signature is checked in small time slices, so a big history or a flood fills in gradually instead of freezing the page.
- When the sky is busy, the page launches a sample of rockets (cities in view and near you first), merges the rest into one volley per city, and summarises them in a single toast.

## Seeding

`node tools/seed.mjs` lights about 260 diyas across 52 cities (and a starting cracker count) so the map isn't empty on day one. They're signed by a dedicated key and shown openly as **Diwali Globe**. They never appear as a person or as live activity, and real wishes always show first in a city's tooltip. `--delete` removes them, `--resend` re-publishes them to a relay that missed them, and `--room=name` targets a private room. The key lives in `.seed-key`, which is git-ignored.

## Develop

```sh
npm install
npm run build          # bundles src/main.js -> app.js (committed, since Pages has no build step)
python3 -m http.server 8765
```

## Credits

- Map data: [Natural Earth](https://www.naturalearthdata.com) (public domain), India point-of-view borders.
- Firework sounds: the explosion is "Firework launch explosion" from GFX Sounds (gfxsounds.com); the whistle is from "Silvester fireworks from the street 01" by stephan, Wikimedia Commons (public domain).
- Diya bell: "ghanta, leather mallet" by the_very_Real_Horst (freesound.org/s/274316), via Wikimedia Commons, CC0.
