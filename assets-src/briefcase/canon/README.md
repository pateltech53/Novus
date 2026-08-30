# Canon founder renders

Empty until the two canon founders are crowned:

```sh
npm run art:briefcase -- bases          # generate candidates
npm run art:briefcase -- crown --base novus --pick <n>
npm run art:briefcase -- crown --base nova --pick <n>
```

The crowned `novus.png` / `nova.png` are committed on purpose — they ride
along as the face-and-proportions reference in every one of the 202 skin
generations, and any future skin must be generated against the exact same
two files or it won't match the catalog. See docs/BRIEFCASE-ART.md.
