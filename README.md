# 🪔 Diwali Globe

A blank night globe, just coastlines, country borders and Indian states, that flies in to your city. Light a diya or burst a cracker: the camera pulls back and your fireworks go off above your city, while bursts from everyone else light up India and the world, live.

**Live:** https://voideepak.github.io/diwali/

- Your city comes from a free IP lookup. Tap **Not right?** to use precise browser location. Only the city name and coordinates rounded to about 10 km are shared.
- Every diya is one small warm dot, and it stays lit for everyone who visits. The map starts dark and fills in as people light diyas, so busy cities glow like cities at night. The **Brightest cities** leaderboard ranks them live; click a city to fly there.
- Crackers make a real firework sound, timed so the bang lands exactly when the shell bursts on screen. Your own crackers are loud; other people's are softer and farther away.
- Use **My city / India / World** to jump between your city, India and the whole world. Hover or tap a diya to read the wishes from that city.
- Private room for family or friends: add `?c=<room-name>` to the link.
- Static site on GitHub Pages: no server, no accounts, no cost. Events are small signed messages on free, open [Nostr](https://nostr.com) relays.

## Develop

```sh
npm install
npm run build          # bundles src/main.js -> app.js (committed, since Pages has no build step)
python3 -m http.server 8765
```

## Credits

- Map data: [Natural Earth](https://www.naturalearthdata.com) (public domain), India point-of-view borders.
- Firework sound: "Firework launch explosion" from GFX Sounds (gfxsounds.com).
