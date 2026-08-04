# Novus — run a company, pitch it out loud

Source: http://localhost:3000/found

To create a video from this capture, use the `product-launch-video` skill.

## What's in This Capture

| File | Contents |
|------|----------|
| `screenshots/contact-sheet.jpg` | **View this first.** All scroll screenshots in labeled grid — see the entire page at a glance |
| `screenshots/scroll-*.png` | Individual viewport screenshots if you need detail on a specific section. |
| `extracted/tokens.json` | Design tokens: 8 colors, 6 fonts, 2 headings, 1 CTAs |
| `extracted/design-styles.json` | Computed styles from live DOM: typography hierarchy, button/card/nav styles, spacing scale, border-radius, box shadows. Primary data source for DESIGN.md. |
| `extracted/asset-descriptions.md` | One-line description of every downloaded asset. Read this for asset selection — only open individual files for safe-zone checking. |
| `extracted/visible-text.txt` | Page text in DOM order, prefixed with HTML tag (`[h1]`, `[p]`, `[a]`). Use as context — rephrase freely. |
| `assets/contact-sheet.jpg` | Downloaded images in labeled grid — view before opening individual files |
| `assets/svgs/contact-sheet.jpg` | SVGs rendered as thumbnails in labeled grid |
| `assets/` | Individual downloaded images, SVGs, and font files. |

## Brand Summary

- **Colors**: #EDEBE6 (bg-light), #232019 (surface-dark), #FCFCFA (bg-light), #DAD9D5 (surface-light), #82807B (neutral), #FCFCFC (bg-light), #FFFFFF (bg-light), #E35F00 (accent)
- **Fonts**: Urbanist (400,500,600,700,800), IBM Plex Mono (400,500,600,700), Instrument Serif (400), Baloo 2 (600,700,800), __nextjs-Geist (400-600 variable), __nextjs-Geist Mono (400-600 variable)
