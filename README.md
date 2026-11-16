# BonfireSTACK Tracks

A listening site for tracks made in [BonfireSTACK](https://mehesz.net/bonfire/). Nothing is
recorded: a track is a BonfireSTACK patch file, and the listener's browser plays it live with the
app's own engine (no rack on screen).

- **Listeners** get a track list with search and tags, likes (the automatic Favorites playlist),
  their own playlists, and an **OPEN IN BonfireSTACK** button that opens the track's patch in the
  app. Likes and playlists are kept in the browser (localStorage) only.
- **You** get `admin.html`: sign in, upload a patch, give it a title, description, tags and an
  optional ambiance image. Tracks without an image show `public/default.jpg`. Busy patches can be
  too much for a small machine to synthesize live, so a track can also get an **MP3 version** (1
  minute at most): when it has one, the player loops the MP3 instead of the patch; everything else
  (OPEN IN BonfireSTACK, likes, playlists, timed play) stays the same.

## Run it locally

Needs the BonfireSTACK source next to this folder (`../bonfirestack`), because the player imports
the engine straight from it.

```sh
cp .env.example .env     # then set ADMIN_PASSWORD
npm install
npm run dev              # API on :5065 + the site on http://localhost:5173
npm run seed             # optional, once: fills an EMPTY library with BonfireSTACK's demo patches
```

Admin is at `http://localhost:5173/admin.html`.

Other scripts: `npm run api` (API alone), `npm run build` (static site in `dist/`), `npm start`
(API that also serves `dist/`, to try the built site as one process on :5065).

## How it fits together

| part | where | what it does |
|------|-------|--------------|
| player | `index.html`, `src/player.js`, `src/styles.css` | the listening page |
| audio | `src/audio.js` | loads the engine (from the app, or the built-in copy) and plays patches with it |
| library | `src/library.js` | favorites, playlists and volume in localStorage |
| admin | `admin.html`, `src/admin.js` | add / edit / delete tracks |
| API | `server/server.mjs` | no dependencies, Node 16+; tracks as plain files |

### Where the engine comes from

The site does not carry its own engine release. At run time it loads `engine.js` from the app
itself (`<app url>/engine.js`, default `https://mehesz.net/bonfire/`), which BonfireSTACK's build
publishes under that fixed name (`src/player-engine.js` there). **Releasing a new BonfireSTACK
updates the sound of this site too, with no rebuild here.** The small "Engine: …" line at the
bottom of the sidebar says which one is in use.

- `app (v…)`: loaded from the app. This is the normal case.
- `built-in (v…)`: the fallback copy built into this site from `../bonfirestack/src` (alias
  `@bonfire`, `BONFIRE_SRC` to override). It is used while developing (`npm run dev`), and when the
  app's `engine.js` can't be loaded: the app is offline, the live app is older than this feature, or
  the two are on different domains without CORS.

If the site is NOT on the same domain as the app, the app's folder has to allow it, e.g. in Apache:
`Header set Access-Control-Allow-Origin "*"` for `/bonfire/` (the engine and its audio worklet are
loaded cross-site). On the same domain nothing is needed.

Build switches: `VITE_APP_URL` (where the app lives; also where OPEN IN BonfireSTACK points),
`VITE_ENGINE=local` (never load from the app), `VITE_ENGINE=remote` (load from the app in dev too).

Data lives in `server/data/` (or `DATA_DIR`): `tracks.json`, `patches/<id>.json`,
`images/<id>.jpg`, `audio/<id>.mp3`. Back that folder up; it is not in git.

### API

| | |
|---|---|
| `GET api/tracks` | published tracks |
| `GET api/tracks/<id>/patch` | a track's patch |
| `GET api/media/images/<file>` | a track's image |
| `GET api/media/audio/<file>` | a track's MP3 version |
| `POST api/login` `{password}` | `{token}`, valid 12 hours; send as `Authorization: Bearer <token>` |
| `GET / POST api/admin/tracks` | list all (drafts too) / add `{title, description, tags, published, patch, image, audio}` |
| `PUT / DELETE api/admin/tracks/<id>` | change / remove one |

`image` is a `data:` URL; the admin page shrinks pictures to 1920 px JPEGs before sending.
`audio` is a `data:audio/mpeg` URL of an MP3; the admin page refuses anything over 60 seconds, the
server anything over 3 MB or not an MP3. `''` removes either one.

## Deploy

The pages are static and call the API with relative URLs (`api/...`), so the site works from any
sub-path as long as `<site>/api/` reaches the Node process.

1. **API**: copy `server/server.mjs`, `ecosystem.config.example.js` and `.env.example` to the
   server. There, the first time only, make the real configs from the examples (both stay out of
   git): `cp ecosystem.config.example.js ecosystem.config.js` and a `.env` with a real
   `ADMIN_PASSWORD`. Then `pm2 start ecosystem.config.js && pm2 save`
   (later: `pm2 restart bonfire-tracks-api`). The library goes to `server/data/` unless `DATA_DIR`
   says otherwise; keep it outside the web root.
2. **Pages**: `npm run build`, then upload `dist/` to the web root folder for the site.
3. **Apache**: proxy the site's `api/` to the API, e.g. for a site at `/tracks/`:

   ```apache
   ProxyPass        /tracks/api/ http://127.0.0.1:5065/api/
   ProxyPassReverse /tracks/api/ http://127.0.0.1:5065/api/
   ```

Deploy a BonfireSTACK build that includes `engine.js` first (any build from 2026-11-10 on), or the
site falls back to its built-in engine. Set `VITE_APP_URL` at build time if the app is not at
`https://mehesz.net/bonfire/`.

## Good to know

- **Tracks loop** until the listener pauses or skips. There is no seeking.
- **Live buttons are not in a patch**: FRIDGE / STUTTER presses made while playing in the app are
  not part of a track; their TRIG jacks are.
- **Samples dropped into the app from your computer** are not in the patch file. The admin page
  warns when a patch uses them; listeners would hear those parts missing.
- **Weak devices**: on machines with 4 or fewer cores (or 4 GB or less memory, where the browser
  reports it) a one-time notice says busy tracks may crackle.
- **Phones**: browsers may pause live-rendered audio when the screen locks.
