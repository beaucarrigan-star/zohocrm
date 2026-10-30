# Knowledge tab v2.0 — what changed and how to add pictures

Built 30 Oct 2026 (v2.0.1 live in Zoho since 30 Oct). Replaces widget-knowledge-v1.0-s43.zip on the **Knowledge** widget (Setup › Developer Hub › Widgets). Start page stays `/knowledge.html`. Nothing changes in the Knowledge Articles module.

## What's new
- **Home screen.** Opens on a search box, a tile per vendor (devices and article counts), the four ways in, and "Used most on cases".
- **Home button and breadcrumbs** on every screen (Home › Vendor › Device › Article). Back to list stays.
- **Theme switch** (Auto / Light / Dark) at the bottom of the left rail. Remembered per browser. Auto follows the computer.
- **Fewer dropdowns.** Vendor and Device up front; Type, Topic and Audience sit behind "More filters". Clicking a vendor or way in on the left starts fresh (clears search and filters).
- **Pictures in articles**, with click to enlarge. Cards show a small "▣ 2" chip when an article has pictures.
- **Full articles.** Zoho's bulk query cuts long Steps text short; v1.0 showed only the first few lines of long articles. v2.0.1 fetches the full record when an article is opened (a brief "Loading the full article…" line appears, then the rest fills in).
- Vendor tiles carry a one-line note of what the vendor makes. Edit them in `knowledge-data.js` (`VENDOR_NOTES`).

## How to put a picture in an article
In the article's **Steps** field, type a tag on its own where the picture should go:

    [img: sentinel/om500/om500-p08-12.jpg | Pin orientation]

- The part before `|` is the file name from `picture-index.csv` (the `file` column).
- The part after `|` is the caption. Leave it out if you don't want one: `[img: sentinel/om500/om500-p08-12.jpg]`
- Works inside a numbered step (put it after the step's text) or as its own paragraph.
- Only files inside the widget's `img/` folder show. A wrong file name shows a broken picture, not an error.

## Picture library
243 pictures clipped from the vendor guides and the Alco Tag guide, in `img/<vendor>/<device>/`:

| Folder | Guide | Count |
|---|---|---|
| sentinel/om500 | OM500 Instruction Manual | 31 |
| supercom/pureone | PureOne / PureMonitor Operational Training 1.0.1 | 45 |
| supercom/pureshield | PureShield User Guide V1.3 (victim-side app) | 14 |
| buddi/navigation | Buddi Navigation Quick Start Guide | 12 |
| buddi/alcotag | buddi Alco Tag Installation Guide (manuals.plus) — kit, locking plates, ankle measure, removal tool | 4 |
| allied/at1 (at1-ar-*) | AT1 Attachment and Removal Guide | 19 |
| allied/at1 (at1-ug-*) | AT1 User Guide | 62 |
| allied/em-manager | EM Manager User Guide | 56 |
| scram | Remote Breath Pro Troubleshooting is text only — no pictures | 0 |

`picture-index.csv` lists every file with the guide, page, the section heading on that page and a guess at the caption. The contact sheets in `picture-sheets/` show every picture at thumbnail size for choosing.

## Adding new pictures later
1. Drop the file into `app/img/<vendor>/<device>/` in the unzipped widget folder (JPG or PNG, 900 px wide is plenty).
2. Re-zip the folder (plugin-manifest.json at the top level, everything else under `app/`).
3. Setup › Developer Hub › Widgets › Knowledge › upload the new zip. Zoho's limits: 25 MB per widget, 5 MB per file. This zip is about 9 MB.
4. Reference it from an article with the `[img: ...]` tag.
