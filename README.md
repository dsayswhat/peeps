# peeps — Kid Check-In

A little tracker for staying in touch. Kid Check-In is a tiny installable web app (a PWA) that shows a photo card for each kid. Tap a card's button each time you **talk** to or **text** that kid.

- Plain HTML, CSS and JavaScript. There's no framework, build step or server code.
- All data stays on your phone, in the browser's IndexedDB storage. Nothing is uploaded.
- Works offline after the first visit.

## Using it

| Action | How |
|---|---|
| Add one to a count | Tap **💬 Talked** or **✉️ Texted** |
| Take one away | Long-press the button (about half a second). Counts never go below 0. |
| Undo the last change | Tap **Undo** on the message at the bottom (shown for 4 seconds) |
| Add, rename, re-photo, reorder or delete kids | Tap ⚙️ (top right) to enter edit mode, then tap **Done** when finished |
| Start a new counting period | **Reset all** at the bottom. It asks first, and you can undo it. |

## Install on Android

1. Open the site in **Chrome**: `https://dsayswhat.github.io/peeps/`
2. Tap the **⋮** menu, then **Add to Home screen** (or **Install app**), then **Install**.
3. Open it from the new home-screen icon. It runs full-screen, like a normal app.

On first launch, add your kids from the ⚙️ screen. The photo picker lets you choose **Camera** or a photo from your gallery.

## Back up and restore

Your data lives only in Chrome on this phone. **Clearing Chrome's site data or uninstalling the app erases it**, so export a backup now and then.

- **Back up:** ⚙️ → **⬇️ Export**. This saves a file such as `kid-checkin-backup-2026-11-14.json` to your Downloads folder. The file includes the photos, so you can copy it somewhere safe (Drive, email to yourself, etc.).
- **Restore:** ⚙️ → **⬆️ Import**, then pick the backup file. You'll be asked to confirm, because a restore **replaces** everything currently in the app.

## Deploying to GitHub Pages

1. Push this repo to GitHub on the `main` branch.
2. In the repo, go to **Settings → Pages → Build and deployment**, then choose **Deploy from a branch**, branch **`main`**, folder **`/ (root)`**, and **Save**.
3. After a minute, the site is live at `https://<user>.github.io/<repo>/`.

All paths in the app are relative, so it works under the `/<repo>/` subpath. The empty `.nojekyll` file tells Pages to serve the files as they are, without running Jekyll.

## Updating the app

The service worker caches every app file, which is what makes the app work offline. It's also why a new version needs one extra step:

1. Make your changes.
2. In `sw.js`, **bump `CACHE_VERSION`** (for example, from `'v1'` to `'v2'`). Do this on every deploy, or phones will keep the old cached files.
3. Commit and push. Wait about a minute for Pages to publish.
4. On the phone, **fully close the app** (swipe it away in the recent-apps view) and open it again. The app downloads the new version in the background and reloads itself once it's ready. If the change doesn't show up, close and reopen it one more time.

The version currently running is shown in small text under **Reset all**. Your kids and counts are not affected by updates.

If you add a new file the app needs (another image, for example), also add it to the `APP_FILES` list in `sw.js`.

## Files

| File | What it does |
|---|---|
| `index.html` | The page structure: header, edit tools, card grid, dialog and toast |
| `styles.css` | All styling, including dark mode (follows the phone's setting) |
| `app.js` | The app logic, in numbered sections (rendering, edit mode, tallies, reset, backup…) |
| `db.js` | A small IndexedDB wrapper: database `kid-tally`, with stores `kids` and `meta` |
| `sw.js` | The service worker that provides offline caching (bump `CACHE_VERSION` on deploy) |
| `manifest.webmanifest` | Name, icons and colours used when the app is installed |
| `icons/` | App icons. Regenerate them with `python3 tools/make_icons.py` (needs Pillow). They're not used at runtime. |

## Testing on a computer

Service workers need `https://` or `localhost`, so opening `index.html` as a file won't fully work. Serve the folder instead:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/ in Chrome
```

To check installability in Chrome, open DevTools → **Application** → **Manifest**. Any problems that would stop the app from installing are listed there. (Recent Lighthouse versions no longer include a PWA category.) Use **Application → Service workers → Offline** to test airplane mode.
