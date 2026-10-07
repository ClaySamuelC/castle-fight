# Castle Fight

A 1v1 turn-based fort artillery game. Each player gets a castle and three keepers. Blow holes in the stone, mind the wind, and be the last side standing.

## Play

Create a match and give your opponent the 4-digit code, or join theirs. Practice plays against the castle bot. Same device passes one keyboard back and forth.

Aim with the mouse. Hold **Fire** or **Space** to charge, then release. **A** and **D** walk. **1–3** or **Q** and **E** pick a weapon. **Tab** switches keeper. The scroll wheel nudges the angle.

Rooms link the two browsers directly. GitHub Pages only hosts the page. The code is the room name, and a public relay helps the browsers find each other. If a network blocks that link, same-device play still works.

## Local

```bash
npm install
npm test
npm run dev
```

## Where to add things

- Weapons are data in `src/game/weapons.js`. The simulator does not special-case ids.
- Maps register in `src/game/maps.js` and are chosen with `rules.mapId`.
- Match tuning lives in `src/game/rules.js`.
- Online messages go through `src/net/lobby.js`. Swap that module to host your own relay; both players must use the same transport.
- Protocol and sim versions are `PROTOCOL` and `SIM_VERSION`. Bump the sim version when a change would desync an old client.
