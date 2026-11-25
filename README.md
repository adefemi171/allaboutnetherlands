# All About Netherlands

Use Node 24. Run `npm ci` and `npm run dev` for local development.

## Drive & Ride

Open `/drive/` in the local preview and choose an area. Utrecht–Houten and Amsterdam Oost–Diemen have a shuttle. Scheveningen offers driving, cycling, and walking between the harbour, Keizerstraat, and the Kurhaus. Use WASD, the arrow keys, or the controls under the scene. Space brakes. Choose **Walk** near a footway to explore on foot. The mint arrows guide car and bike trips, and the roadside signs use the local NDW inventory.

To test multiplayer, choose **Drive together → Join room** and open the invite link in another tab. The link opens the same area. Each area has its own rooms. For testing across computers on the same network, start Astro on the host computer's LAN address and open that address on both devices. A static host needs a WebSocket service using `attachDriveRooms(server, boundsByArea)` from `scripts/drive-rooms.mjs` at `/drive/socket`. The bounds object maps area IDs to their manifest's `[width, height]`.

The area catalog in `src/drive/areas.json` sets the area names, starting points, and available travel modes. The corresponding source grid, coordinates, and neighborhood streets are in `scripts/drive-area.mjs`. Rebuild an area's map bundle with Node 24 or later by running these commands from the project root, replacing `amsterdam` with the chosen area ID. With no argument, the scripts rebuild Utrecht–Houten.

```sh
node scripts/build-drive-data.mjs amsterdam
node scripts/build-drive-scenery.mjs amsterdam
node scripts/build-drive-places.mjs amsterdam
node scripts/build-drive-signs.mjs amsterdam
node scripts/build-drive-signals.mjs amsterdam
node scripts/build-drive-walking.mjs amsterdam
node scripts/build-drive-zebras.mjs amsterdam
```

Zebra crossings come from OpenStreetMap, which maps the painted crossing on the road. The NDW crossing signs stand at the kerb, often metres away, so they only place zebras in bundles without `zebras.json`.

To refresh only the buildings, run `node scripts/build-drive-scenery.mjs amsterdam --buildings-only`. It re-bakes the 3DBAG meshes with each building's floor height (3DBAG LiDAR), its use (BAG register: shops get shopfronts) and its construction era, and keeps the aerial photos and route guides. Roofs take their colour from the aerial photos in the browser.
