# 🪔 Diwali Globe

A spinning dark globe that flies in to your city. Light a diya or burst a cracker: the camera pulls back and your fireworks go off above your city, while bursts from everyone else light up India and the world, live.

**Live:** https://voideepak.github.io/diwali/

- Your city comes from a free IP lookup. Tap **Not right?** to use precise browser location. Only the city name and coordinates rounded to about 10 km are shared.
- Every diya stays lit for everyone who visits. The more diyas a city has, the bigger it glows, and the **🏆 Brightest cities** leaderboard ranks them live. Click a city to fly there.
- Crackers make real sounds: a whistle as the rocket climbs, then the boom. Your own crackers are loud; other people's are softer and farther away.
- Use 📍 / 🇮🇳 / 🌏 to jump between your city, India and the whole world. Hover or tap a diya to read the wishes from that city.
- Private room for family or friends: add `?c=<room-name>` to the link.
- Static site on GitHub Pages: no server, no accounts, no cost. Events are small signed messages on free, open [Nostr](https://nostr.com) relays.

## Develop

```sh
npm install
npm run build          # bundles src/main.js -> app.js (committed, since Pages has no build step)
python3 -m http.server 8765
```

## Credits

- Earth imagery: NASA Blue Marble / Black Marble (public domain).
- Firework sounds: "Silvester fireworks from the street 01" and "Fireworks piece" by stephan, Wikimedia Commons (public domain).
