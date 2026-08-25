# Retro Loader

A Decky Loader plugin that turns the Steam Deck into an 8-bit boot menu.
Pick a game from a text catalogue of tape names, watch the border stripes,
listen to the pilot tone, and eventually it launches.

Five machines ship. Adding another is one file.

| Theme | Grid | Name limit | The wait | Sound |
| --- | --- | --- | --- | --- |
| ZX Spectrum +2 | 32x24 | 10 chars | Interlaced SCREEN$ | Pilot tone |
| Commodore 64 | 40x25 | 16 chars | Blanked screen, strobing border | Pilot tone |
| MS-DOS / PC | 80x25 | 8.3 (`REDDEA~1.EXE`) | Memory count to 640K | Drive seek |
| Teletext | 40x25 | 22 chars | Header digits cycling | Silent |
| VT100 | 80x24 | 14 chars | Output at 300 baud | Teletype clatter |

The name limit is the joke, and every machine tells it differently.

Each theme also supplies its own Quick Access verb ("Insert tape", "Boot",
"Switch on", "Log in"), its own failure message, and its own load sound —
a pilot tone would be nonsense on a VT100.

## What it does

- **Boot menu** — the real thing, rendered pixel-for-pixel. Rainbow stripes
  and the Amstrad/Sinclair copyright on the Spectrum; `**** COMMODORE 64
  BASIC V2 ****` and a `LIST`ing on the C64.
- **Catalogue** — your installed games as a tape or disk directory.
  Authentic mode truncates names to what a real header allowed: ten
  characters on the Spectrum, sixteen on the C64. "Red Dead R". "Disco
  Elys". This is the joke and it is free.
- **Load sequence** — border stripes, pilot tone, and a loading screen that
  fills in the way the hardware actually filled it. Then the game starts.
- **Tape Tester** — battery, session time and program count, dressed as a
  signal check.

Only installed games are listed. A tape catalogue offering things that
aren't on the tape would be a lie, and the joke depends on the list being
real.

## Controls

| Button | Action |
| --- | --- |
| D-pad up/down | Move the cursor |
| L1 / R1 | Page |
| A | LOAD, or skip the rest of a load |
| B | Back, or abort a load with `R Tape loading error, 0:1` |
| Y | Toggle authentic names |

Arrow keys, Enter, Escape and Y do the same in desktop mode.

## Building

```sh
pnpm install
pnpm build
```

Then deploy `dist/`, `main.py`, `plugin.json` and `package.json` to
`~/homebrew/plugins/retro-loader/` on the Deck.

## Adding a machine

Everything machine-specific lives behind the `Theme` interface in
`src/themes/types.ts`. A theme owns its palette, font, geometry, boot menu,
catalogue layout and load animation. The route component owns navigation
and Steam plumbing and knows nothing about any particular computer.

1. Implement `Theme` in `src/themes/yourmachine.ts`.
2. Add it to `THEMES` in `src/themes/index.ts`.

That is the whole procedure. The Quick Access dropdown and the settings
file both read from the registry.

The later themes exist partly to prove this. Four changes to the shared
core came out of writing them, all in `src/display.ts` and
`src/fontutil.ts`:

1. The attribute plane widened from 8 bits to 16, so a 16-colour palette
   fits (C64).
2. The load animation moved wholly into the theme, because a loading C64
   blanks its display rather than revealing a bitmap.
3. Glyph rows became plain numbers rather than bytes, so a cell can be
   wider than eight pixels (teletext, at 16x16).
4. The compositor was rewritten around a `Uint32Array` with border-strip
   filling, because 640x400 is five times the pixels of a Spectrum
   screen. Worst case is now 1.6ms a frame.

Nothing since has needed a fifth.

## Legal position

Nothing copyrighted is bundled. No character ROM, no BIOS image, no
manufacturer's font.

- **Teletext and VT100 are the cleanest.** The teletext repertoire is an
  ETSI standard rather than any vendor's ROM, its 2x3 mosaic graphics are
  generated from first principles in `fontutil.ts`, and the VT100 theme
  borrows neither palette nor glyphs — the box-drawing characters are
  synthesised from an up/down/left/right mask.
- **The DOS theme invents its BIOS strings.** No vendor's POST text is
  reproduced. For a real 8x16 CP437 font, VileR's Ultimate Oldschool PC
  Font Pack is Creative Commons and drops straight into `buildFont()`.
- **Spectrum and C64 borrow letterforms** from the +2 recreation's 8x8
  set, which is the one thing across the whole plugin worth checking the
  provenance of before shipping.

I'm not a lawyer, and the font licences above are worth verifying rather
than taking on trust.

## Known gaps

- **Every theme uses the Spectrum 8x8 letterforms**, scaled. The C64 is
  not PETSCII, the DOS theme is not CP437, and teletext is not the ETSI
  face. `fontutil.ts` is where a real bitmap would go; nothing else needs
  touching.
- **Block counts in the C64 directory are invented.** A 1541 held 664
  blocks; nothing in a modern library would fit on one. The figure is
  scaled to look right and stay monotonic with real size.
- **Load timing is untested against real Deck frame pacing.** The
  animation is driven off `performance.now()` rather than frame count, so
  it should hold, but it has not been measured on hardware.
- Decky cannot replace the Deck's shell, so this is a route you navigate
  to from Quick Access, not a boot screen. It covers the display with a
  fixed-position layer rather than injecting CSS into Steam's own classes,
  which is uglier in theory and far less likely to break on a client
  update.
- The display is a single canvas, so there are no DOM rows for Steam to
  focus. Navigation reads raw gamepad buttons from one `Focusable`.

## Credits

Built on two earlier Ayrshire Pixels projects: the ZX Spectrum +2 OS
recreation, which supplied the character set, palette, attribute
compositing and boot menu layout, and Game Roulette, which supplied the
Decky scaffold and the defensive pattern for reading Steam's live stores.

Not affiliated with Sky, Amstrad, Commodore or Valve.

## Licence

BSD-3-Clause.
