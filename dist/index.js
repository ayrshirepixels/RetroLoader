const manifest = {"name":"Retro Loader"};
const API_VERSION = 2;
const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[@decky/api]: Failed to connect to the loader as as the loader API was not initialized. This is likely a bug in Decky Loader.');
}
let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
}
catch {
    api = internalAPIConnection.connect(1, manifest.name);
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version 1. Some features may not work.`);
}
if (api._version != API_VERSION) {
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version ${api._version}. Some features may not work.`);
}
const callable = api.callable;
const routerHook = api.routerHook;
const toaster = api.toaster;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

/* A compact cassette, drawn to read clearly at 20px in the Quick
   Access rail. currentColor throughout so Steam's theming applies. */
function CassetteIcon(props) {
    const size = props.size ?? 20;
    return (SP_JSX.jsxs("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [SP_JSX.jsx("rect", { x: "2", y: "5", width: "20", height: "14", rx: "2" }), SP_JSX.jsx("circle", { cx: "8.5", cy: "12", r: "2.2" }), SP_JSX.jsx("circle", { cx: "15.5", cy: "12", r: "2.2" }), SP_JSX.jsx("path", { d: "M8.5 12h7" }), SP_JSX.jsx("path", { d: "M6 19l1.5-3h9L18 19" })] }));
}

/* ------------------------------------------------------------------ *
 * Load audio.
 *
 * beep() is the BEEP implementation from the +2 OS recreation. The
 * rest is per-machine: a pilot tone is right for a Spectrum and wrong
 * for a VT100, so the theme picks a profile and this module builds it.
 *
 * The looping profiles generate their pattern into a single audio
 * buffer rather than scheduling hundreds of gain envelopes. One node,
 * one loop, no drift.
 * ------------------------------------------------------------------ */
let ctx = null;
function context() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx)
            return null;
        if (!ctx)
            ctx = new Ctx();
        if (ctx && ctx.state === "suspended")
            void ctx.resume();
        return ctx;
    }
    catch {
        return null;
    }
}
/** Unlock audio from a user gesture. Steam's webview needs this once. */
function primeAudio() {
    context();
}
/** BEEP duration, pitch — semitones from middle C. */
function beep(duration, pitch, volume = 0.12) {
    const c = context();
    if (!c)
        return;
    try {
        const f = 440 * Math.pow(2, (pitch - 9) / 12);
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "square";
        o.frequency.value = f;
        g.gain.value = volume;
        o.connect(g).connect(c.destination);
        const t = c.currentTime;
        o.start(t);
        o.stop(t + Math.max(0.01, duration));
    }
    catch {
        /* best effort */
    }
}
const SILENT = { stop: () => undefined };
/** Deterministic noise, so a given profile sounds the same every time. */
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}
/** A short percussive click with exponential decay, written in place. */
function click(data, at, lengthSamples, gain, rand) {
    for (let i = 0; i < lengthSamples; i++) {
        const idx = at + i;
        if (idx >= data.length)
            return;
        const env = Math.exp(-i / (lengthSamples * 0.25));
        data[idx] += (rand() * 2 - 1) * env * gain;
    }
}
/** Mechanical clatter — a teleprinter running at about thirty a second. */
function teletypeBuffer(c) {
    const rate = c.sampleRate;
    const buf = c.createBuffer(1, rate, rate);
    const data = buf.getChannelData(0);
    const rand = rng(31337);
    const per = Math.floor(rate / 30);
    for (let n = 0; n < 30; n++)
        click(data, n * per, Math.floor(rate * 0.004), 0.9, rand);
    return buf;
}
/** Motor hum with seek chatter, for a machine with a disk in it. */
function driveBuffer(c) {
    const rate = c.sampleRate;
    const buf = c.createBuffer(1, rate * 2, rate);
    const data = buf.getChannelData(0);
    const rand = rng(90125);
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.sin((2 * Math.PI * 58 * i) / rate) * 0.12;
    }
    let at = Math.floor(rate * 0.1);
    while (at < data.length) {
        const burst = 3 + Math.floor(rand() * 6);
        const spacing = Math.floor(rate * (0.008 + rand() * 0.01));
        for (let n = 0; n < burst; n++) {
            click(data, at + n * spacing, Math.floor(rate * 0.005), 0.55, rand);
        }
        at += burst * spacing + Math.floor(rate * (0.12 + rand() * 0.35));
    }
    return buf;
}
/** Square noise, for the data section of a tape. */
function tapeDataBuffer(c) {
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const data = buf.getChannelData(0);
    const rand = rng(2168);
    for (let i = 0; i < data.length; i++)
        data[i] = rand() > 0.5 ? 0.7 : -0.7;
    return buf;
}
/**
 * Start the load sound for a machine. `pilotMs` only means anything
 * to the tape profile, where it is the length of the leader before
 * the data starts screeching.
 */
function playLoadSound(profile, pilotMs, volume = 0.06) {
    if (profile === "silent")
        return SILENT;
    const c = context();
    if (!c)
        return SILENT;
    let stopped = false;
    const stoppables = [];
    const nodes = [];
    try {
        const master = c.createGain();
        master.gain.value = volume;
        master.connect(c.destination);
        nodes.push(master);
        if (profile === "tape") {
            // Pilot: steady 807 Hz square, which is what 2168 T-states comes
            // out at on a 3.5 MHz machine.
            const pilot = c.createOscillator();
            const pilotGain = c.createGain();
            pilot.type = "square";
            pilot.frequency.value = 807;
            pilotGain.gain.setValueAtTime(1, c.currentTime);
            pilotGain.gain.setValueAtTime(0, c.currentTime + pilotMs / 1000);
            pilot.connect(pilotGain).connect(master);
            pilot.start();
            stoppables.push(pilot);
            nodes.push(pilotGain);
            // Data: filtered noise, gated on as the pilot drops.
            const noise = c.createBufferSource();
            noise.buffer = tapeDataBuffer(c);
            noise.loop = true;
            const bp = c.createBiquadFilter();
            bp.type = "bandpass";
            bp.frequency.value = 1600;
            bp.Q.value = 0.8;
            const dataGain = c.createGain();
            dataGain.gain.setValueAtTime(0, c.currentTime);
            dataGain.gain.setValueAtTime(1, c.currentTime + pilotMs / 1000);
            noise.connect(bp).connect(dataGain).connect(master);
            noise.start();
            stoppables.push(noise);
            nodes.push(bp, dataGain);
        }
        else {
            const src = c.createBufferSource();
            src.buffer = profile === "drive" ? driveBuffer(c) : teletypeBuffer(c);
            src.loop = true;
            const filter = c.createBiquadFilter();
            if (profile === "drive") {
                filter.type = "lowpass";
                filter.frequency.value = 3200;
            }
            else {
                filter.type = "highpass";
                filter.frequency.value = 900;
            }
            src.connect(filter).connect(master);
            src.start();
            stoppables.push(src);
            nodes.push(filter);
        }
        const stop = () => {
            if (stopped)
                return;
            stopped = true;
            try {
                master.gain.setValueAtTime(master.gain.value, c.currentTime);
                master.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.05);
                setTimeout(() => {
                    for (const s of stoppables) {
                        try {
                            s.stop();
                        }
                        catch {
                            /* already stopped */
                        }
                    }
                    for (const n of [...stoppables, ...nodes]) {
                        try {
                            n.disconnect();
                        }
                        catch {
                            /* ignore */
                        }
                    }
                }, 80);
            }
            catch {
                /* ignore */
            }
        };
        return { stop };
    }
    catch {
        return SILENT;
    }
}
/** Menu movement tick. */
function tick() {
    beep(0.012, 24, 0.08);
}
/** Selection confirm. */
function chirp() {
    beep(0.05, 12, 0.1);
    setTimeout(() => beep(0.07, 24, 0.1), 55);
}

/* ------------------------------------------------------------------ *
 * Display core.
 *
 * A direct port of the framebuffer from the ZX Spectrum +2 OS
 * recreation, generalised so a theme supplies the palette, font and
 * geometry. Everything below is 8-bit-machine mechanics: a one-bit
 * pixel plane plus a coarser attribute plane, composited at draw time.
 * That attribute-clash behaviour is the whole point — do not be
 * tempted to "fix" it with per-pixel colour.
 * ------------------------------------------------------------------ */
/* Attribute packing, one 16-bit word per cell:
 *
 *   bit 15  flash
 *   bit 14  bright
 *   bits 13-7  paper (0-63)
 *   bits 6-0   ink   (0-63)
 *
 * The Spectrum only ever uses three bits of each colour field, but
 * widening this is what lets a 16-colour machine share the renderer.
 * Themes that write d.attr directly must use packAttr() or these
 * constants rather than assuming the Spectrum's byte layout. */
const ATTR_COLOUR_MASK = 0x3f;
const ATTR_PAPER_SHIFT = 7;
const ATTR_BRIGHT_BIT = 1 << 14;
const ATTR_FLASH_BIT = 1 << 15;
class Display {
    constructor(geom, palette, font) {
        this.border = 7;
        this.ink = 0;
        this.paper = 7;
        this.bright = 0;
        this.flash = 0;
        this.inverse = 0;
        this.over = 0;
        /** Print cursor, in cells. */
        this.cx = 0;
        this.cy = 0;
        this.flashOn = false;
        this.buffer = null;
        /* ---------------- compositing ---------------- */
        this.words = null;
        this.packed = [];
        this.packedFor = null;
        this.geom = geom;
        this.palette = palette;
        this.font = font;
        this.cols = Math.floor(geom.width / geom.cellW);
        this.rows = Math.floor(geom.height / geom.cellH);
        this.frameW = geom.width + geom.borderX * 2;
        this.frameH = geom.height + geom.borderY * 2;
        this.pix = new Uint8Array(geom.width * geom.height);
        this.attr = new Uint16Array(this.cols * this.rows);
        this.cls();
    }
    get frameWidth() {
        return this.frameW;
    }
    get frameHeight() {
        return this.frameH;
    }
    rgb(colour, bright) {
        const pair = this.palette[colour & ATTR_COLOUR_MASK] ?? this.palette[0];
        return pair[bright ? 1 : 0] ?? pair[0];
    }
    packAttr() {
        return ((this.flash ? ATTR_FLASH_BIT : 0) |
            (this.bright ? ATTR_BRIGHT_BIT : 0) |
            ((this.paper & ATTR_COLOUR_MASK) << ATTR_PAPER_SHIFT) |
            (this.ink & ATTR_COLOUR_MASK));
    }
    cls() {
        this.pix.fill(0);
        this.attr.fill(this.packAttr());
        this.cx = 0;
        this.cy = 0;
    }
    setAttributes(a) {
        if (a.ink !== undefined)
            this.ink = a.ink;
        if (a.paper !== undefined)
            this.paper = a.paper;
        if (a.bright !== undefined)
            this.bright = a.bright;
        if (a.flash !== undefined)
            this.flash = a.flash;
    }
    /** Paint an attribute block over a cell rectangle, inclusive. */
    attrRect(c0, r0, c1, r1, ink, paper, bright) {
        const a = (bright ? ATTR_BRIGHT_BIT : 0) |
            ((paper & ATTR_COLOUR_MASK) << ATTR_PAPER_SHIFT) |
            (ink & ATTR_COLOUR_MASK);
        for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) {
            for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) {
                this.attr[r * this.cols + c] = a;
            }
        }
    }
    /* ---------------- text ---------------- */
    putGlyph(code, col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows)
            return;
        const g = this.font[code] || this.font[63];
        if (!g)
            return;
        const { width, cellW, cellH } = this.geom;
        for (let y = 0; y < cellH; y++) {
            let bits = g[y];
            if (this.inverse)
                bits ^= 0xff;
            for (let x = 0; x < cellW; x++) {
                const idx = (row * cellH + y) * width + (col * cellW + x);
                const on = (bits >> (cellW - 1 - x)) & 1;
                if (this.over)
                    this.pix[idx] ^= on;
                else
                    this.pix[idx] = on;
            }
        }
        this.attr[row * this.cols + col] = this.packAttr();
    }
    scroll() {
        const { width, height, cellH } = this.geom;
        this.pix.copyWithin(0, width * cellH, width * height);
        this.pix.fill(0, width * (height - cellH), width * height);
        this.attr.copyWithin(0, this.cols, this.cols * this.rows);
        const a = this.packAttr();
        for (let i = this.cols * (this.rows - 1); i < this.cols * this.rows; i++)
            this.attr[i] = a;
    }
    newline() {
        this.cx = 0;
        this.cy++;
        if (this.cy >= this.rows) {
            this.cy = this.rows - 1;
            this.scroll();
        }
    }
    printChar(code) {
        if (code === 13) {
            this.newline();
            return;
        }
        this.putGlyph(code, this.cx, this.cy);
        this.cx++;
        if (this.cx >= this.cols)
            this.newline();
    }
    print(str) {
        for (const ch of str)
            this.printChar(ch.charCodeAt(0));
    }
    printAt(row, col) {
        this.cy = Math.max(0, Math.min(this.rows - 1, row));
        this.cx = Math.max(0, Math.min(this.cols - 1, col));
    }
    /** Print at a cell, then restore nothing — convenience for static layouts. */
    say(row, col, str) {
        this.printAt(row, col);
        this.print(str);
    }
    /** Draw the font scaled up by an integer factor, ink pixels only. */
    bigText(str, x0, y0, scale) {
        const { width, height, cellW, cellH } = this.geom;
        let x = x0;
        for (const ch of str) {
            const g = this.font[ch.charCodeAt(0)] || this.font[32];
            if (g) {
                for (let gy = 0; gy < cellH; gy++) {
                    const row = g[gy];
                    for (let gx = 0; gx < cellW; gx++) {
                        if (!((row >> (cellW - 1 - gx)) & 1))
                            continue;
                        for (let dy = 0; dy < scale; dy++) {
                            for (let dx = 0; dx < scale; dx++) {
                                const X = x + gx * scale + dx;
                                const Y = y0 + gy * scale + dy;
                                if (X >= 0 && X < width && Y >= 0 && Y < height)
                                    this.pix[Y * width + X] = 1;
                            }
                        }
                    }
                }
            }
            x += cellW * scale;
        }
    }
    /** Width in pixels that bigText() would occupy. */
    bigTextWidth(str, scale) {
        return [...str].length * this.geom.cellW * scale;
    }
    /** Pack the palette into native-endian RGBA words, once. */
    packPalette() {
        const probe = new ArrayBuffer(4);
        const little = new Uint8Array(probe);
        new Uint32Array(probe)[0] = 0x01;
        const isLE = little[0] === 0x01;
        this.packed = this.palette.map((pair) => pair.map((c) => isLE
            ? ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0
            : ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | 255) >>> 0));
        this.packedFor = this.palette;
    }
    render(ctx) {
        if (!this.buffer) {
            this.buffer = ctx.createImageData(this.frameW, this.frameH);
            this.words = new Uint32Array(this.buffer.data.buffer);
        }
        if (this.packedFor !== this.palette)
            this.packPalette();
        const w = this.words;
        const { width, height, cellW, cellH, borderX, borderY } = this.geom;
        const fw = this.frameW;
        // Border: fill the four strips rather than the whole frame. On a
        // 640x400 screen that is the difference between touching 256k
        // pixels twice a frame and touching them once.
        const bpair = this.packed[this.border & ATTR_COLOUR_MASK] ?? this.packed[0];
        const bc = bpair[0];
        if (borderY > 0) {
            w.fill(bc, 0, borderY * fw);
            w.fill(bc, (borderY + height) * fw, this.frameH * fw);
        }
        if (borderX > 0) {
            for (let y = borderY; y < borderY + height; y++) {
                const o = y * fw;
                w.fill(bc, o, o + borderX);
                w.fill(bc, o + borderX + width, o + fw);
            }
        }
        for (let py = 0; py < height; py++) {
            const cellRow = Math.floor(py / cellH) * this.cols;
            const pixRow = py * width;
            let o = (borderY + py) * fw + borderX;
            let cell = -1;
            let inkWord = 0;
            let paperWord = 0;
            let swap = false;
            for (let px = 0; px < width; px++) {
                const c = cellRow + Math.floor(px / cellW);
                if (c !== cell) {
                    cell = c;
                    const a = this.attr[c];
                    const br = a & ATTR_BRIGHT_BIT ? 1 : 0;
                    const inkPair = this.packed[a & ATTR_COLOUR_MASK] ?? this.packed[0];
                    const paperPair = this.packed[(a >> ATTR_PAPER_SHIFT) & ATTR_COLOUR_MASK] ?? this.packed[0];
                    inkWord = inkPair[br] ?? inkPair[0];
                    paperWord = paperPair[br] ?? paperPair[0];
                    swap = Boolean(a & ATTR_FLASH_BIT) && this.flashOn;
                }
                const on = this.pix[pixRow + px];
                w[o++] = (swap ? !on : on) ? inkWord : paperWord;
            }
        }
        ctx.putImageData(this.buffer, 0, 0);
    }
    /** CSS colour for the current border, for filling the area outside the frame. */
    borderCss() {
        const c = this.rgb(this.border, 0);
        return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
}

/* ------------------------------------------------------------------ *
 * ZX Spectrum 8x8 character set.
 *
 * Lifted verbatim from the Ayrshire Pixels ZX Spectrum +2 OS
 * recreation. Each glyph is eight rows of eight columns, '#' = ink.
 * Codes 128-143 (block graphics) are generated at runtime in
 * spectrum.ts rather than stored here.
 * ------------------------------------------------------------------ */
const GLYPHS = {
    " ": "........|........|........|........|........|........|........|........",
    "!": "........|...#....|...#....|...#....|...#....|........|...#....|........",
    '"': "........|..#.#...|..#.#...|........|........|........|........|........",
    "#": "........|..#.#...|.#####..|..#.#...|.#####..|..#.#...|........|........",
    "$": "...#....|..####..|.#.#....|..###...|...#.#..|.####...|...#....|........",
    "%": "........|.##...#.|.##..#..|....#...|...#....|..#..##.|.#...##.|........",
    "&": "........|..##....|.#..#...|..##....|.#..#.#.|.#...#..|..###.#.|........",
    "'": "........|...#....|...#....|..#.....|........|........|........|........",
    "(": "........|....#...|...#....|...#....|...#....|...#....|....#...|........",
    ")": "........|...#....|....#...|....#...|....#...|....#...|...#....|........",
    "*": "........|........|..#.#...|...#....|.#####..|...#....|..#.#...|........",
    "+": "........|........|...#....|...#....|.#####..|...#....|...#....|........",
    ",": "........|........|........|........|........|..##....|...#....|..#.....",
    "-": "........|........|........|........|.#####..|........|........|........",
    ".": "........|........|........|........|........|........|..##....|..##....",
    "/": "........|......#.|.....#..|....#...|...#....|..#.....|.#......|........",
    "0": "........|..###...|.#...#..|.#..##..|.#.#.#..|.##..#..|..###...|........",
    "1": "........|...#....|..##....|...#....|...#....|...#....|..###...|........",
    "2": "........|..###...|.#...#..|....#...|...#....|..#.....|.#####..|........",
    "3": "........|.#####..|....#...|...##...|.....#..|.#...#..|..###...|........",
    "4": "........|...##...|..#.#...|.#..#...|.#####..|....#...|....#...|........",
    "5": "........|.#####..|.#......|.####...|.....#..|.#...#..|..###...|........",
    "6": "........|..###...|.#......|.####...|.#...#..|.#...#..|..###...|........",
    "7": "........|.#####..|.....#..|....#...|...#....|..#.....|..#.....|........",
    "8": "........|..###...|.#...#..|..###...|.#...#..|.#...#..|..###...|........",
    "9": "........|..###...|.#...#..|.#...#..|..####..|.....#..|..###...|........",
    ":": "........|........|..##....|..##....|........|..##....|..##....|........",
    ";": "........|........|..##....|..##....|........|..##....|...#....|..#.....",
    "<": "........|....#...|...#....|..#.....|.#......|..#.....|...#....|....#...",
    "=": "........|........|........|.#####..|........|.#####..|........|........",
    ">": "........|.#......|..#.....|...#....|....#...|...#....|..#.....|.#......",
    "?": "........|..###...|.#...#..|....#...|...#....|........|...#....|........",
    "@": "........|..###...|.#...#..|.#.###..|.#.###..|.#......|..####..|........",
    "A": "........|..###...|.#...#..|.#...#..|.#####..|.#...#..|.#...#..|........",
    "B": "........|.####...|.#...#..|.####...|.#...#..|.#...#..|.####...|........",
    "C": "........|..####..|.#......|.#......|.#......|.#......|..####..|........",
    "D": "........|.###....|.#..#...|.#...#..|.#...#..|.#..#...|.###....|........",
    "E": "........|.#####..|.#......|.####...|.#......|.#......|.#####..|........",
    "F": "........|.#####..|.#......|.####...|.#......|.#......|.#......|........",
    "G": "........|..####..|.#......|.#......|.#..##..|.#...#..|..####..|........",
    "H": "........|.#...#..|.#...#..|.#####..|.#...#..|.#...#..|.#...#..|........",
    "I": "........|..###...|...#....|...#....|...#....|...#....|..###...|........",
    "J": "........|....##..|.....#..|.....#..|.....#..|.#...#..|..###...|........",
    "K": "........|.#...#..|.#..#...|.###....|.#..#...|.#...#..|.#...#..|........",
    "L": "........|.#......|.#......|.#......|.#......|.#......|.#####..|........",
    "M": "........|.#...#..|.##.##..|.#.#.#..|.#...#..|.#...#..|.#...#..|........",
    "N": "........|.#...#..|.##..#..|.#.#.#..|.#..##..|.#...#..|.#...#..|........",
    "O": "........|..###...|.#...#..|.#...#..|.#...#..|.#...#..|..###...|........",
    "P": "........|.####...|.#...#..|.#...#..|.####...|.#......|.#......|........",
    "Q": "........|..###...|.#...#..|.#...#..|.#.#.#..|.#..#...|..##.#..|........",
    "R": "........|.####...|.#...#..|.#...#..|.####...|.#..#...|.#...#..|........",
    "S": "........|..####..|.#......|..###...|.....#..|.#...#..|..###...|........",
    "T": "........|.#####..|...#....|...#....|...#....|...#....|...#....|........",
    "U": "........|.#...#..|.#...#..|.#...#..|.#...#..|.#...#..|..###...|........",
    "V": "........|.#...#..|.#...#..|.#...#..|.#...#..|..#.#...|...#....|........",
    "W": "........|.#...#..|.#...#..|.#...#..|.#.#.#..|.##.##..|.#...#..|........",
    "X": "........|.#...#..|..#.#...|...#....|...#....|..#.#...|.#...#..|........",
    "Y": "........|.#...#..|.#...#..|..#.#...|...#....|...#....|...#....|........",
    "Z": "........|.#####..|....#...|...#....|..#.....|.#......|.#####..|........",
    "[": "........|..###...|..#.....|..#.....|..#.....|..#.....|..###...|........",
    "\\": "........|.#......|..#.....|...#....|....#...|.....#..|......#.|........",
    "]": "........|..###...|....#...|....#...|....#...|....#...|..###...|........",
    "^": "........|...#....|..#.#...|.#...#..|........|........|........|........",
    "_": "........|........|........|........|........|........|........|.#####..",
    "`": "........|...#....|...#....|....#...|........|........|........|........",
    "a": "........|........|..###...|.....#..|..####..|.#...#..|..####..|........",
    "b": "........|.#......|.#......|.####...|.#...#..|.#...#..|.####...|........",
    "c": "........|........|..####..|.#......|.#......|.#......|..####..|........",
    "d": "........|.....#..|.....#..|..####..|.#...#..|.#...#..|..####..|........",
    "e": "........|........|..###...|.#...#..|.#####..|.#......|..####..|........",
    "f": "........|...##...|..#..#..|..#.....|.###....|..#.....|..#.....|........",
    "g": "........|........|..####..|.#...#..|..####..|.....#..|..###...|........",
    "h": "........|.#......|.#......|.####...|.#...#..|.#...#..|.#...#..|........",
    "i": "........|...#....|........|..##....|...#....|...#....|..###...|........",
    "j": "........|....#...|........|....#...|....#...|.#..#...|..##....|........",
    "k": "........|.#......|.#......|.#..#...|.###....|.#..#...|.#...#..|........",
    "l": "........|..##....|...#....|...#....|...#....|...#....|..###...|........",
    "m": "........|........|.##.#...|.#.#.#..|.#.#.#..|.#...#..|.#...#..|........",
    "n": "........|........|.####...|.#...#..|.#...#..|.#...#..|.#...#..|........",
    "o": "........|........|..###...|.#...#..|.#...#..|.#...#..|..###...|........",
    "p": "........|........|.####...|.#...#..|.#...#..|.####...|.#......|.#......",
    "q": "........|........|..####..|.#...#..|.#...#..|..####..|.....#..|.....#..",
    "r": "........|........|.#.###..|.##.....|.#......|.#......|.#......|........",
    "s": "........|........|..####..|.#......|..###...|.....#..|.####...|........",
    "t": "........|..#.....|.####...|..#.....|..#.....|..#..#..|...##...|........",
    "u": "........|........|.#...#..|.#...#..|.#...#..|.#...#..|..####..|........",
    "v": "........|........|.#...#..|.#...#..|.#...#..|..#.#...|...#....|........",
    "w": "........|........|.#...#..|.#...#..|.#.#.#..|.#.#.#..|..#.#...|........",
    "x": "........|........|.#...#..|..#.#...|...#....|..#.#...|.#...#..|........",
    "y": "........|........|.#...#..|.#...#..|..####..|.....#..|..###...|........",
    "z": "........|........|.#####..|....#...|...#....|..#.....|.#####..|........",
    "{": "........|....##..|...#....|...#....|..##....|...#....|...#....|....##..",
    "|": "........|...#....|...#....|...#....|........|...#....|...#....|...#....",
    "}": "........|..##....|....#...|....#...|...##...|....#...|....#...|..##....",
    "~": "........|........|..##.#..|.#.##...|........|........|........|........",
    "\u00a9": "..###...|.#...#..|.#.##.#.|.#.#..#.|.#.##.#.|.#...#..|..###...|........"
};

/* ------------------------------------------------------------------ *
 * Font construction.
 *
 * One 8x8 source set, shared by every theme. Machines with taller or
 * wider cells scale it here rather than shipping their own bitmaps.
 *
 * A glyph is an array of `cellH` numbers, each holding `cellW` bits,
 * most significant bit leftmost. That is why widening past eight
 * columns still works: the rows are plain JavaScript numbers, not
 * bytes, so a 16-wide cell is just a 16-bit row value.
 * ------------------------------------------------------------------ */
/** The 8x8 set, exactly as the +2 recreation packed it. */
function baseFont() {
    const chars = {};
    for (const ch in GLYPHS) {
        const rows = GLYPHS[ch].split("|");
        chars[ch.charCodeAt(0)] = rows.map((r) => {
            let b = 0;
            for (let x = 0; x < 8; x++)
                if (r[x] === "#")
                    b |= 0x80 >> x;
            return b;
        });
    }
    chars[169] = chars["\u00a9".charCodeAt(0)];
    return chars;
}
/**
 * Scale every glyph by integer factors. Row doubling is how an 8x8
 * set fills an 8x16 cell; it is chunkier than a real 8x16 ROM font
 * but geometrically correct, which is what keeps the aspect ratio
 * honest on a 1280x800 panel.
 */
function scaleFont(font, sx, sy) {
    const out = {};
    for (const code in font) {
        const rows = font[code];
        const wide = rows.map((row) => {
            if (sx === 1)
                return row;
            let w = 0;
            for (let x = 0; x < 8; x++) {
                if (!((row >> (7 - x)) & 1))
                    continue;
                for (let d = 0; d < sx; d++)
                    w |= 1 << (8 * sx - 1 - (x * sx + d));
            }
            return w;
        });
        const tall = [];
        for (const row of wide)
            for (let d = 0; d < sy; d++)
                tall.push(row);
        out[code] = tall;
    }
    return out;
}
/** Solid block, for cursors. */
function solidBlock(cellW, cellH) {
    const row = (1 << cellW) - 1;
    return new Array(cellH).fill(row);
}
/**
 * ZX-style 2x2 quadrant graphics, sixteen combinations from the low
 * nibble of the code offset.
 */
function mosaic2x2(cellW, cellH) {
    const out = {};
    const left = ((1 << (cellW / 2)) - 1) << (cellW / 2);
    const right = (1 << (cellW / 2)) - 1;
    for (let g = 0; g < 16; g++) {
        const rows = [];
        for (let y = 0; y < cellH; y++) {
            const top = y < cellH / 2;
            let b = 0;
            if (top ? g & 1 : g & 4)
                b |= left;
            if (top ? g & 2 : g & 8)
                b |= right;
            rows.push(b);
        }
        out[g] = rows;
    }
    return out;
}
/**
 * Teletext mosaic graphics: a 2x3 grid of blocks, sixty-four
 * combinations, occupying codes 32..63 and 96..127 on real hardware.
 * Bit order is the standard one — top-left is bit 0, reading left to
 * right then down.
 */
function mosaic2x3(cellW, cellH) {
    const out = {};
    const left = ((1 << (cellW / 2)) - 1) << (cellW / 2);
    const right = (1 << (cellW / 2)) - 1;
    const band = cellH / 3;
    for (let g = 0; g < 64; g++) {
        const rows = [];
        for (let y = 0; y < cellH; y++) {
            const row = Math.min(2, Math.floor(y / band));
            let b = 0;
            if (g & (1 << (row * 2)))
                b |= left;
            if (g & (1 << (row * 2 + 1)))
                b |= right;
            rows.push(b);
        }
        out[g] = rows;
    }
    return out;
}
/**
 * Box-drawing characters, synthesised rather than borrowed. DEC's
 * line-drawing set and CP437's box characters are the same shapes;
 * both are generated from a four-bit up/down/left/right mask.
 */
const BOX = {
    H: 0xc0,
    V: 0xc1,
    TL: 0xc2,
    TR: 0xc3,
    BL: 0xc4,
    BR: 0xc5,
    TEE_L: 0xc6,
    TEE_R: 0xc7,
    SHADE: 0xc8,
};
function boxGlyphs(cellW, cellH) {
    const midY = Math.floor(cellH / 2);
    const midX = Math.floor(cellW / 2);
    const full = (1 << cellW) - 1;
    const leftHalf = full ^ ((1 << (cellW - midX)) - 1);
    const rightHalf = (1 << (cellW - midX)) - 1;
    const vbit = 1 << (cellW - 1 - midX);
    const make = (up, down, left, right) => {
        const rows = [];
        for (let y = 0; y < cellH; y++) {
            let b = 0;
            if (y === midY) {
                if (left)
                    b |= leftHalf;
                if (right)
                    b |= rightHalf;
                b |= vbit;
            }
            else if ((y < midY && up) || (y > midY && down)) {
                b |= vbit;
            }
            rows.push(b);
        }
        return rows;
    };
    const shade = [];
    for (let y = 0; y < cellH; y++) {
        let b = 0;
        for (let x = 0; x < cellW; x++)
            if ((x + y) % 2 === 0)
                b |= 1 << (cellW - 1 - x);
        shade.push(b);
    }
    return {
        [BOX.H]: make(false, false, true, true),
        [BOX.V]: make(true, true, false, false),
        [BOX.TL]: make(false, true, false, true),
        [BOX.TR]: make(false, true, true, false),
        [BOX.BL]: make(true, false, false, true),
        [BOX.BR]: make(true, false, true, false),
        [BOX.TEE_L]: make(true, true, false, true),
        [BOX.TEE_R]: make(true, true, true, false),
        [BOX.SHADE]: shade,
    };
}
/** Convenience: build a font at a given cell size with extras merged in. */
function buildAt(cellW, cellH, extras = []) {
    const scaled = scaleFont(baseFont(), cellW / 8, cellH / 8);
    const out = { ...scaled, ...boxGlyphs(cellW, cellH) };
    out[160] = solidBlock(cellW, cellH);
    for (const extra of extras)
        Object.assign(out, extra);
    return out;
}

/* ------------------------------------------------------------------ *
 * Commodore 64 theme.
 *
 * Written second, on purpose: a contract with one implementation is
 * just a class with extra steps. Two things had to change in the core
 * to accommodate this machine, both of them in display.ts — the
 * attribute plane widened from 8 bits to 16 so a 16-colour palette
 * fits, and the theme now owns the whole load animation rather than
 * assuming the Spectrum's interlaced SCREEN$ reveal. The C64 blanks
 * its display during a tape load and strobes the border, which needs
 * no shadow buffer at all.
 *
 * KNOWN INAUTHENTICITY: this uses the Spectrum 8x8 font, not PETSCII.
 * The glyph shapes are wrong. Drop a real character-ROM dump into
 * buildFont() below and everything else stays as it is.
 * ------------------------------------------------------------------ */
const GEOMETRY$4 = {
    width: 320,
    height: 200,
    cellW: 8,
    cellH: 8,
    borderX: 32,
    borderY: 24,
};
/* VIC-II palette, Pepto's measured values. No brightness bit on this
   machine, so each entry pairs with itself. */
const C64 = [
    [0, 0, 0], // 0 black
    [255, 255, 255], // 1 white
    [136, 57, 50], // 2 red
    [103, 182, 189], // 3 cyan
    [139, 63, 150], // 4 purple
    [85, 160, 73], // 5 green
    [64, 49, 141], // 6 blue
    [191, 206, 114], // 7 yellow
    [139, 84, 41], // 8 orange
    [87, 66, 0], // 9 brown
    [184, 105, 98], // 10 light red
    [80, 80, 80], // 11 dark grey
    [120, 120, 120], // 12 grey
    [148, 224, 137], // 13 light green
    [120, 105, 196], // 14 light blue
    [159, 159, 159], // 15 light grey
];
const PALETTE$4 = C64.map((c) => [c, c]);
const BLACK$3 = 0;
const WHITE$2 = 1;
const BLUE$2 = 6;
const LIGHT_BLUE = 14;
const LIGHT_GREEN = 13;
const LIGHT_RED = 10;
const CATALOGUE_ROWS$4 = 14;
function buildFont$4() {
    const chars = baseFont();
    chars[160] = solidBlock(8, 8);
    return chars;
}
const MENU$4 = [
    { label: 'LOAD "*",8,1', action: "catalogue" },
    { label: "DEVICE STATUS", action: "diagnostics" },
    { label: "OPTIONS", action: "settings" },
    { label: "INFO", action: "about" },
    { label: "SYS 64738", action: "exit" },
];
function resetAttributes$4(d) {
    d.border = LIGHT_BLUE;
    d.paper = BLUE$2;
    d.ink = LIGHT_BLUE;
    d.bright = 0;
    d.flash = 0;
    d.inverse = 0;
    d.over = 0;
}
function field$2(str, width) {
    const s = str.length > width ? str.slice(0, width) : str;
    return s + " ".repeat(width - s.length);
}
function rightField$2(str, width) {
    const s = str.length > width ? str.slice(0, width) : str;
    return " ".repeat(width - s.length) + s;
}
/** Filenames are 16 characters on this machine, not ten. */
function fileName(game, authentic) {
    const clean = game.name.replace(/[^\x20-\x7e]/g, "").trim() || "UNTITLED";
    const upper = clean.toUpperCase();
    return authentic ? upper.slice(0, 16) : upper.slice(0, 24);
}
/**
 * Block counts are a fiction. A 1541 disk held 664 blocks of 254
 * bytes; nothing in a modern library would fit on one, or on a
 * thousand. So the figure is scaled to land in 1541 territory and
 * stay monotonic with real size, which is all the listing needs.
 */
function blocks(game) {
    if (game.sizeOnDisk <= 0)
        return 1;
    return Math.max(1, Math.min(664, Math.round(game.sizeOnDisk / 254 / 1024 / 1024)));
}
/** Reverse-video bar across the full width of a row. */
function bar$1(d, row) {
    d.attrRect(0, row, d.cols - 1, row, BLUE$2, LIGHT_BLUE, 0);
    d.setAttributes({ ink: BLUE$2, paper: LIGHT_BLUE });
}
function normal$1(d) {
    d.setAttributes({ ink: LIGHT_BLUE, paper: BLUE$2 });
}
/** The two-line power-on banner, identical on every screen. */
function banner$2(d) {
    d.say(1, 4, "**** COMMODORE 64 BASIC V2 ****");
    d.say(3, 1, "64K RAM SYSTEM  38911 BASIC BYTES FREE");
}
function cursor$2(d, row, col) {
    d.inverse = 1;
    d.say(row, col, " ");
    d.inverse = 0;
}
/* ------------------------------------------------------------------ *
 * Screens                                                             *
 * ------------------------------------------------------------------ */
function drawMenu$4(d, selected) {
    resetAttributes$4(d);
    d.cls();
    banner$2(d);
    d.say(5, 0, "READY.");
    d.say(6, 0, 'LOAD"$",8');
    d.say(8, 0, "SEARCHING FOR $");
    d.say(9, 0, "LOADING");
    d.say(10, 0, "READY.");
    d.say(12, 0, "LIST");
    MENU$4.forEach((entry, i) => {
        const row = 14 + i;
        if (i === selected)
            bar$1(d, row);
        else
            normal$1(d);
        d.say(row, 0, field$2(` ${(i + 1) * 10} ${entry.label}`, d.cols));
    });
    normal$1(d);
    d.say(20, 0, "READY.");
    cursor$2(d, 21, 0);
}
function drawCatalogue$4(d, view) {
    resetAttributes$4(d);
    d.cls();
    const { games, selected, scroll, authentic } = view;
    d.say(0, 0, 'LOAD"$",8');
    d.say(1, 0, "SEARCHING FOR $");
    d.say(2, 0, "LOADING");
    d.say(3, 0, "READY.");
    d.say(4, 0, "LIST");
    d.say(6, 0, rightField$2("0", 4) + '  "DECK TAPE       " 00 2A');
    if (games.length === 0) {
        d.say(8, 0, "?FILE NOT FOUND  ERROR");
        d.say(10, 0, "NOTHING INSTALLED. TRY OPTIONS");
        d.say(11, 0, "TO SHOW NON-STEAM SHORTCUTS.");
        d.setAttributes({ ink: LIGHT_GREEN });
        d.say(24, 0, " B MENU");
        return;
    }
    for (let i = 0; i < CATALOGUE_ROWS$4; i++) {
        const idx = scroll + i;
        if (idx >= games.length)
            break;
        const g = games[idx];
        const row = 7 + i;
        if (idx === selected)
            bar$1(d, row);
        else
            normal$1(d);
        const line = rightField$2(`${blocks(g)}`, 4) +
            "  " +
            field$2(`"${fileName(g, authentic)}"`, 26) +
            (g.nonSteam ? "USR" : "PRG");
        d.say(row, 0, field$2(line, d.cols));
    }
    normal$1(d);
    const free = Math.max(0, 664 - games.reduce((n, g) => n + blocks(g), 0));
    d.say(22, 0, `${free} BLOCKS FREE.`);
    d.say(23, 0, "READY.");
    d.setAttributes({ ink: LIGHT_GREEN });
    d.say(24, 0, " A LOAD   B MENU   Y AUTHENTIC NAMES");
}
function drawDiagnostics$4(d, diag) {
    resetAttributes$4(d);
    d.cls();
    d.say(0, 0, "OPEN 1,8,15");
    d.say(1, 0, "INPUT#1,A$,B$,C$,D$");
    d.say(2, 0, "PRINT A$;B$;C$;D$");
    d.setAttributes({ ink: LIGHT_GREEN });
    d.say(4, 0, "00, OK,00,00");
    normal$1(d);
    const mins = Math.floor(diag.uptimeSeconds / 60);
    const secs = diag.uptimeSeconds % 60;
    const battery = diag.batteryPercent === null ? "N/A" : `${diag.batteryPercent}%`;
    const rows = [
        ["DEVICE", "8"],
        ["MOTOR", "OFF"],
        ["BATTERY", battery + (diag.charging ? " CHARGING" : "")],
        ["UPTIME", `${mins}M ${secs}S`],
        ["PROGRAMS", `${diag.gameCount}`],
    ];
    rows.forEach(([k, v], i) => {
        d.say(7 + i * 2, 0, field$2(k, 14) + ": " + v);
    });
    d.say(19, 0, "READY.");
    cursor$2(d, 20, 0);
    d.setAttributes({ ink: LIGHT_GREEN });
    d.say(24, 0, " B MENU");
}
function drawSettings$4(d, rows, selected) {
    resetAttributes$4(d);
    d.cls();
    d.say(0, 0, "LIST 1000-");
    d.say(2, 0, "READY.");
    rows.forEach((row, i) => {
        const r = 5 + i * 2;
        if (i === selected)
            bar$1(d, r);
        else
            normal$1(d);
        d.say(r, 0, field$2(` ${1000 + i * 10} ${row.label.toUpperCase()}`, 26) + field$2(row.value.toUpperCase(), 14));
    });
    normal$1(d);
    d.say(18, 0, "READY.");
    cursor$2(d, 19, 0);
    d.setAttributes({ ink: LIGHT_GREEN });
    d.say(23, 0, " LEFT/RIGHT TO CHANGE");
    d.say(24, 0, " A TOGGLE   B MENU");
}
function drawAbout$4(d, version) {
    resetAttributes$4(d);
    d.cls();
    banner$2(d);
    d.say(5, 0, "READY.");
    d.say(6, 0, "RUN");
    const lines = [
        `RETRO LOADER ${version.toUpperCase()}`,
        "",
        "A DECKY LOADER PLUGIN THAT MAKES",
        "LAUNCHING A GAME TAKE AS LONG AS",
        "IT DID IN 1986.",
        "",
        "THIS THEME USES THE SPECTRUM FONT,",
        "NOT PETSCII. PATCHES WELCOME.",
        "",
        "SEE SRC/THEMES/TYPES.TS TO ADD",
        "YOUR OWN MACHINE.",
    ];
    lines.forEach((line, i) => d.say(8 + i, 0, line));
    d.setAttributes({ ink: LIGHT_RED });
    d.say(20, 0, "NOT AFFILIATED WITH ANYONE.");
    d.setAttributes({ ink: LIGHT_GREEN });
    d.say(24, 0, " B MENU");
}
/* ------------------------------------------------------------------ *
 * Loading                                                             *
 *                                                                     *
 * No shadow buffer here. A loading C64 blanks its display entirely and
 * strobes the border, so every frame is drawn from scratch off the
 * progress value alone.                                               *
 * ------------------------------------------------------------------ */
function beginLoad$4(_d, _game, _authentic) {
    /* nothing to prepare */
}
function drawLoadFrame$4(d, game, progress, elapsedMs) {
    const name = fileName(game, true);
    // Blanked display: the whole screen becomes border colour, strobing.
    if (progress >= 0.12 && progress < 0.92) {
        const strobe = Math.floor(elapsedMs / 16) % C64.length;
        d.border = strobe;
        d.paper = strobe;
        d.ink = strobe;
        d.bright = 0;
        d.flash = 0;
        d.inverse = 0;
        d.cls();
        return;
    }
    resetAttributes$4(d);
    d.cls();
    banner$2(d);
    d.say(5, 0, "READY.");
    d.say(6, 0, 'LOAD "*",8,1');
    if (progress < 0.12) {
        d.say(8, 0, "PRESS PLAY ON TAPE");
        return;
    }
    // Loaded. The tape header is read back, then it runs.
    d.say(8, 0, "PRESS PLAY ON TAPE");
    d.say(9, 0, "OK");
    d.say(10, 0, `FOUND ${name}`);
    d.say(11, 0, "LOADING");
    d.say(12, 0, "READY.");
    d.say(13, 0, "RUN");
    if (progress >= 0.97) {
        d.setAttributes({ ink: WHITE$2 });
        const scale = name.length <= 10 ? 2 : 1;
        const w = d.bigTextWidth(name, scale);
        d.bigText(name, Math.max(0, Math.floor((d.geom.width - w) / 2)), 128, scale);
        for (let c = 0; c < d.cols; c++) {
            d.attrRect(c, 16, c, 17, (c % 15) + 1, BLACK$3, 0);
        }
    }
}
function drawLoadError$4(d) {
    resetAttributes$4(d);
    d.cls();
    banner$2(d);
    d.say(5, 0, "READY.");
    d.say(6, 0, 'LOAD "*",8,1');
    d.say(8, 0, "PRESS PLAY ON TAPE");
    d.setAttributes({ ink: LIGHT_RED });
    d.say(10, 0, "?LOAD ERROR");
    normal$1(d);
    d.say(11, 0, "READY.");
    cursor$2(d, 12, 0);
}
const c64Theme = {
    id: "c64",
    name: "Commodore 64",
    blurb: "Blue on blue, 300 baud, PRESS PLAY ON TAPE",
    launchLabel: "Press play on tape",
    errorToast: "?LOAD ERROR",
    soundProfile: "tape",
    geometry: GEOMETRY$4,
    palette: PALETTE$4,
    buildFont: buildFont$4,
    resetAttributes: resetAttributes$4,
    nameLimit: 16,
    menu: MENU$4,
    pilotMs: 3000,
    dataMs: 9000,
    catalogueRows: CATALOGUE_ROWS$4,
    drawMenu: drawMenu$4,
    drawCatalogue: drawCatalogue$4,
    drawDiagnostics: drawDiagnostics$4,
    drawAbout: drawAbout$4,
    drawSettings: drawSettings$4,
    beginLoad: beginLoad$4,
    drawLoadFrame: drawLoadFrame$4,
    drawLoadError: drawLoadError$4,
};

/* Column helpers. Every one of these machines lays its screens out on
   a fixed character grid, so padding and truncation are the whole of
   the layout engine. */
function field$1(str, width) {
    const s = str.length > width ? str.slice(0, width) : str;
    return s + " ".repeat(width - s.length);
}
function rightField$1(str, width) {
    const s = str.length > width ? str.slice(0, width) : str;
    return " ".repeat(width - s.length) + s;
}
function centre(str, width) {
    if (str.length >= width)
        return str.slice(0, width);
    const pad = Math.floor((width - str.length) / 2);
    return " ".repeat(pad) + str + " ".repeat(width - str.length - pad);
}
/** "Red Dead ..... 101" — a dot leader between label and value. */
function leader(label, value, width, dot = ".") {
    const room = width - value.length - 1;
    const name = label.length > room ? label.slice(0, room) : label;
    const dots = Math.max(1, room - name.length);
    return name + dot.repeat(dots) + " " + value;
}
/** Thousands separators, for DOS directory listings. */
function commas(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
/** A stable pseudo-date per app, so listings do not flicker. */
function stampFor(appid) {
    const mm = ((appid * 7) % 12) + 1;
    const dd = ((appid * 13) % 28) + 1;
    const yy = 85 + ((appid * 3) % 12);
    const hh = (appid * 5) % 12 || 12;
    const mi = (appid * 11) % 60;
    const pm = appid % 2 === 0;
    const p2 = (v) => String(v).padStart(2, "0");
    return {
        date: `${p2(mm)}-${p2(dd)}-${p2(yy)}`,
        time: `${p2(hh)}:${p2(mi)}${pm ? "p" : "a"}`,
    };
}

/* ------------------------------------------------------------------ *
 * MS-DOS / PC theme.
 *
 * 80x25 in an 8x16 cell, which is 640x400 — exactly half a 1280x800
 * panel, so it scales 2x to full screen with nothing left over.
 *
 * The BIOS strings are invented rather than copied from any real
 * vendor. The 8.3 filename mangling is the joke and it is the same
 * joke as the Spectrum's ten-character tape header, arrived at from
 * the opposite direction: REDDEAD~1.EXE.
 *
 * KNOWN INAUTHENTICITY: the font is the 8x8 set with rows doubled,
 * not a real 8x16 CP437 ROM. VileR's Ultimate Oldschool PC Font Pack
 * is Creative Commons and is what should go here.
 * ------------------------------------------------------------------ */
const GEOMETRY$3 = {
    width: 640,
    height: 400,
    cellW: 8,
    cellH: 16,
    borderX: 0,
    borderY: 0,
};
/* The CGA/EGA sixteen. */
const CGA = [
    [0, 0, 0],
    [0, 0, 170],
    [0, 170, 0],
    [0, 170, 170],
    [170, 0, 0],
    [170, 0, 170],
    [170, 85, 0],
    [170, 170, 170],
    [85, 85, 85],
    [85, 85, 255],
    [85, 255, 85],
    [85, 255, 255],
    [255, 85, 85],
    [255, 85, 255],
    [255, 255, 85],
    [255, 255, 255],
];
const PALETTE$3 = CGA.map((c) => [c, c]);
const BLACK$2 = 0;
const BLUE$1 = 1;
const CYAN$1 = 3;
const LGREY = 7;
const DGREY = 8;
const LGREEN = 10;
const LRED = 12;
const YELLOW$1 = 14;
const WHITE$1 = 15;
const CATALOGUE_ROWS$3 = 15;
const TOTAL_MEMORY = 655360;
function buildFont$3() {
    return buildAt(8, 16);
}
const MENU$3 = [
    { label: "DIR C:\\GAMES", action: "catalogue" },
    { label: "SYSINFO", action: "diagnostics" },
    { label: "SETUP", action: "settings" },
    { label: "TYPE README.TXT", action: "about" },
    { label: "EXIT", action: "exit" },
];
function resetAttributes$3(d) {
    d.border = BLACK$2;
    d.paper = BLACK$2;
    d.ink = LGREY;
    d.bright = 0;
    d.flash = 0;
    d.inverse = 0;
    d.over = 0;
}
function ink$1(d, colour, paper = BLACK$2) {
    d.setAttributes({ ink: colour, paper });
}
/** Reverse-video bar, DOS style: black on light grey. */
function bar(d, row, from = 0, to = -1) {
    const end = to < 0 ? d.cols - 1 : to;
    d.attrRect(from, row, end, row, BLACK$2, LGREY, 0);
    d.setAttributes({ ink: BLACK$2, paper: LGREY });
}
function cursor$1(d, row, col) {
    d.attrRect(col, row, col, row, LGREY, LGREY, 0);
    d.say(row, col, " ");
}
/** VFAT-style 8.3 mangling. Everything long becomes NAME~1. */
function shortName(game) {
    const cleaned = game.name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const stem = cleaned || "GAME";
    return stem.length <= 8 ? stem : stem.slice(0, 6) + "~1";
}
function extension(game) {
    return game.nonSteam ? "BAT" : "EXE";
}
/* ------------------------------------------------------------------ *
 * Screens                                                             *
 * ------------------------------------------------------------------ */
function post(d) {
    ink$1(d, WHITE$1);
    d.say(0, 0, "Ayrshire Pixels BIOS v1.02");
    ink$1(d, LGREY);
    d.say(1, 0, "Copyright (C) 1986-2026 Ayrshire Pixels");
    d.say(3, 0, "Main Processor       : Custom APU");
    d.say(4, 0, `Memory Test          : ${TOTAL_MEMORY}K OK`);
    d.say(6, 0, "Detecting IDE drives ...");
    d.say(7, 0, "  Primary Master     : DECK SSD");
    d.say(8, 0, "  Primary Slave      : None");
}
function drawMenu$3(d, selected) {
    resetAttributes$3(d);
    d.cls();
    post(d);
    ink$1(d, LGREY);
    d.say(10, 0, "Starting DOS...");
    d.say(12, 0, "C:\\>MENU");
    MENU$3.forEach((entry, i) => {
        const row = 14 + i;
        if (i === selected)
            bar(d, row, 0, 39);
        else
            ink$1(d, LGREY);
        d.say(row, 0, field$1("  " + entry.label, 40));
    });
    ink$1(d, LGREY);
    d.say(21, 0, "C:\\>");
    cursor$1(d, 21, 4);
}
function drawCatalogue$3(d, view) {
    resetAttributes$3(d);
    d.cls();
    const { games, selected, scroll, authentic } = view;
    ink$1(d, LGREY);
    d.say(0, 0, "C:\\>DIR C:\\GAMES");
    d.say(2, 0, " Volume in drive C is DECK");
    d.say(3, 0, " Volume Serial Number is 1982-8A64");
    d.say(4, 0, " Directory of C:\\GAMES");
    if (games.length === 0) {
        ink$1(d, LRED);
        d.say(6, 0, "File not found");
        ink$1(d, LGREY);
        d.say(8, 0, "Nothing installed. Try SETUP to show");
        d.say(9, 0, "non-Steam shortcuts.");
        ink$1(d, DGREY);
        d.say(24, 0, " A=Run   B=Menu   Y=Long names");
        return;
    }
    for (let i = 0; i < CATALOGUE_ROWS$3; i++) {
        const idx = scroll + i;
        if (idx >= games.length)
            break;
        const g = games[idx];
        const row = 6 + i;
        if (idx === selected)
            bar(d, row);
        else
            ink$1(d, LGREY);
        const stamp = stampFor(g.appid);
        let line = field$1(shortName(g), 9) +
            field$1(extension(g), 4) +
            rightField$1(commas(g.sizeOnDisk), 15) +
            "  " +
            stamp.date +
            "  " +
            rightField$1(stamp.time, 6);
        if (!authentic)
            line = field$1(line, 48) + field$1(g.name, 32);
        d.say(row, 0, field$1(line, d.cols));
    }
    const total = games.reduce((n, g) => n + g.sizeOnDisk, 0);
    ink$1(d, LGREY);
    // The two totals line up under the size column, as DIR did.
    d.say(22, 0, rightField$1(`${games.length} file(s)`, 12) + rightField$1(commas(total), 16) + " bytes");
    d.say(23, 0, " ".repeat(12) + rightField$1(commas(536870912), 16) + " bytes free");
    ink$1(d, DGREY);
    d.say(24, 0, " A=Run   B=Menu   Y=Long names   PgUp/PgDn=L1/R1");
}
function drawDiagnostics$3(d, diag) {
    resetAttributes$3(d);
    d.cls();
    ink$1(d, LGREY);
    d.say(0, 0, "C:\\>SYSINFO");
    ink$1(d, WHITE$1);
    d.say(2, 0, "System Information");
    ink$1(d, DGREY);
    d.say(3, 0, "\u00c4".repeat(0) + "");
    for (let c = 0; c < 40; c++)
        d.putGlyph(BOX.H, c, 3);
    const mins = Math.floor(diag.uptimeSeconds / 60);
    const secs = diag.uptimeSeconds % 60;
    const rows = [
        ["Operating System", "DOS 6.22 compatible"],
        ["Conventional Memory", `${TOTAL_MEMORY}K`],
        ["Extended Memory", "16744448K"],
        ["Battery", diag.batteryPercent === null ? "n/a" : `${diag.batteryPercent}%${diag.charging ? " (charging)" : ""}`],
        ["Session Uptime", `${mins}m ${secs}s`],
        ["Executables Found", `${diag.gameCount}`],
    ];
    rows.forEach(([k, v], i) => {
        ink$1(d, LGREY);
        d.say(5 + i * 2, 2, field$1(k, 24));
        ink$1(d, YELLOW$1);
        d.print(v);
    });
    ink$1(d, LGREEN);
    d.say(19, 2, "All devices responding.");
    ink$1(d, LGREY);
    d.say(21, 0, "C:\\>");
    cursor$1(d, 21, 4);
    ink$1(d, DGREY);
    d.say(24, 0, " B=Menu");
}
function drawSettings$3(d, rows, selected) {
    // The blue BIOS setup screen, because of course it is.
    d.border = BLUE$1;
    d.paper = BLUE$1;
    d.ink = LGREY;
    d.bright = 0;
    d.flash = 0;
    d.inverse = 0;
    d.cls();
    d.attrRect(0, 0, d.cols - 1, 0, BLACK$2, LGREY, 0);
    d.setAttributes({ ink: BLACK$2, paper: LGREY });
    d.say(0, 0, field$1("  Ayrshire Pixels Setup Utility", 60) + field$1("v1.02", 20));
    // Panel.
    const x0 = 6;
    const x1 = 73;
    const y0 = 3;
    const y1 = 20;
    d.setAttributes({ ink: CYAN$1, paper: BLUE$1 });
    d.putGlyph(BOX.TL, x0, y0);
    d.putGlyph(BOX.TR, x1, y0);
    d.putGlyph(BOX.BL, x0, y1);
    d.putGlyph(BOX.BR, x1, y1);
    for (let c = x0 + 1; c < x1; c++) {
        d.putGlyph(BOX.H, c, y0);
        d.putGlyph(BOX.H, c, y1);
    }
    for (let r = y0 + 1; r < y1; r++) {
        d.putGlyph(BOX.V, x0, r);
        d.putGlyph(BOX.V, x1, r);
    }
    d.setAttributes({ ink: WHITE$1, paper: BLUE$1 });
    d.say(y0 + 1, x0 + 3, "Main   Advanced   Boot   Exit");
    rows.forEach((row, i) => {
        const r = y0 + 4 + i * 2;
        if (i === selected) {
            d.attrRect(x0 + 1, r, x1 - 1, r, BLUE$1, LGREY, 0);
            d.setAttributes({ ink: BLUE$1, paper: LGREY });
        }
        else {
            d.setAttributes({ ink: LGREY, paper: BLUE$1 });
        }
        d.say(r, x0 + 2, " " + field$1(row.label, 34) + field$1("[ " + row.value + " ]", 30));
    });
    d.setAttributes({ ink: CYAN$1, paper: BLUE$1 });
    d.say(22, 4, "\u2191\u2193 Select Item     \u2190\u2192 Change Value");
    d.say(23, 4, "A  Toggle           B  Exit");
}
function drawAbout$3(d, version) {
    resetAttributes$3(d);
    d.cls();
    ink$1(d, LGREY);
    d.say(0, 0, "C:\\>TYPE README.TXT");
    const lines = [
        `RETRO LOADER ${version}`,
        "",
        "A Decky Loader plugin that makes launching a game take as long",
        "as it did in 1986.",
        "",
        "This theme uses the 8x8 character set with rows doubled, not a",
        "real 8x16 CP437 ROM font. VileR's Ultimate Oldschool PC Font",
        "Pack is Creative Commons and belongs here instead.",
        "",
        "The BIOS strings are invented. No vendor was harmed.",
        "",
        "See SRC\\THEMES\\TYPES.TS to add your own machine.",
    ];
    lines.forEach((line, i) => {
        ink$1(d, i === 0 ? WHITE$1 : LGREY);
        d.say(2 + i, 0, line);
    });
    ink$1(d, LGREY);
    d.say(17, 0, "C:\\>");
    cursor$1(d, 17, 4);
    ink$1(d, DGREY);
    d.say(24, 0, " B=Menu");
}
/* ------------------------------------------------------------------ *
 * Loading                                                             *
 *                                                                     *
 * The memory count. It is the purest expression of this plugin's      *
 * entire premise: a number going up while you wait for nothing.       *
 * ------------------------------------------------------------------ */
function beginLoad$3() {
    /* stateless */
}
function drawLoadFrame$3(d, game, progress) {
    resetAttributes$3(d);
    d.cls();
    ink$1(d, WHITE$1);
    d.say(0, 0, "Ayrshire Pixels BIOS v1.02");
    ink$1(d, LGREY);
    d.say(1, 0, "Copyright (C) 1986-2026 Ayrshire Pixels");
    d.say(3, 0, "Main Processor       : Custom APU");
    const counted = Math.min(TOTAL_MEMORY, Math.floor((progress / 0.8) * TOTAL_MEMORY));
    const done = counted >= TOTAL_MEMORY;
    d.say(4, 0, `Memory Test          : ${rightField$1(`${counted}K`, 8)}`);
    if (done) {
        ink$1(d, LGREEN);
        d.print("  OK");
    }
    if (progress < 0.8)
        return;
    ink$1(d, LGREY);
    d.say(6, 0, "Detecting IDE drives ...");
    d.say(7, 0, "  Primary Master     : DECK SSD");
    d.say(9, 0, "Starting DOS...");
    d.say(11, 0, `C:\\GAMES>${shortName(game)}.${extension(game)}`);
    if (progress >= 0.9) {
        ink$1(d, LGREY);
        d.say(12, 0, "Loading");
        const dots = Math.floor((progress - 0.9) * 60);
        d.print(".".repeat(Math.min(8, dots)));
    }
    if (progress >= 0.98) {
        ink$1(d, WHITE$1);
        d.say(14, 0, game.name.toUpperCase());
    }
    cursor$1(d, 16, 0);
}
function drawLoadError$3(d) {
    resetAttributes$3(d);
    d.cls();
    ink$1(d, LGREY);
    d.say(0, 0, "C:\\GAMES>");
    ink$1(d, LRED);
    d.say(2, 0, "General failure reading drive C");
    ink$1(d, LGREY);
    d.say(3, 0, "Abort, Retry, Fail?");
    cursor$1(d, 3, 20);
}
const dosTheme = {
    id: "dos",
    name: "MS-DOS / PC",
    blurb: "640K, 8.3 filenames, Abort Retry Fail",
    launchLabel: "Boot",
    errorToast: "Abort, Retry, Fail?",
    soundProfile: "drive",
    geometry: GEOMETRY$3,
    palette: PALETTE$3,
    buildFont: buildFont$3,
    resetAttributes: resetAttributes$3,
    nameLimit: 8,
    menu: MENU$3,
    pilotMs: 3000,
    dataMs: 7000,
    catalogueRows: CATALOGUE_ROWS$3,
    drawMenu: drawMenu$3,
    drawCatalogue: drawCatalogue$3,
    drawDiagnostics: drawDiagnostics$3,
    drawAbout: drawAbout$3,
    drawSettings: drawSettings$3,
    beginLoad: beginLoad$3,
    drawLoadFrame: drawLoadFrame$3,
    drawLoadError: drawLoadError$3,
};

/* ------------------------------------------------------------------ *
 * ZX Spectrum +2 theme.
 *
 * The reference implementation of the Theme contract. Palette, font,
 * boot menu and stripe order are all lifted from the +2 OS
 * recreation; the catalogue and load screens are new but built from
 * the same primitives.
 * ------------------------------------------------------------------ */
const GEOMETRY$2 = {
    width: 256,
    height: 192,
    cellW: 8,
    cellH: 8,
    borderX: 32,
    borderY: 24,
};
/* 15-colour palette: [normal, bright] for 0..7. */
const PALETTE$2 = [
    [[0, 0, 0], [0, 0, 0]], // 0 black
    [[0, 0, 205], [0, 0, 255]], // 1 blue
    [[205, 0, 0], [255, 0, 0]], // 2 red
    [[205, 0, 205], [255, 0, 255]], // 3 magenta
    [[0, 205, 0], [0, 255, 0]], // 4 green
    [[0, 205, 205], [0, 255, 255]], // 5 cyan
    [[205, 205, 0], [255, 255, 0]], // 6 yellow
    [[205, 205, 205], [255, 255, 255]], // 7 white
];
const STRIPE = [4, 6, 5, 2, 3, 1]; // green, yellow, cyan, red, magenta, blue
const CATALOGUE_ROWS$2 = 20;
function buildFont$2() {
    const chars = baseFont();
    // Block graphics CHR$ 128-143.
    const blocks = mosaic2x2(8, 8);
    for (const g in blocks)
        chars[128 + Number(g)] = blocks[g];
    return chars;
}
const MENU$2 = [
    // These are the machine's own words, not the plugin's — the +2
    // really did call them this. Do not rename them with the product.
    { label: "Tape Loader", action: "catalogue" },
    { label: "Tape Tester", action: "diagnostics" },
    { label: "Options", action: "settings" },
    { label: "48 BASIC", action: "about" },
    { label: "Reset", action: "exit" },
];
function resetAttributes$2(d) {
    d.border = 7;
    d.paper = 7;
    d.ink = 0;
    d.bright = 0;
    d.flash = 0;
    d.inverse = 0;
    d.over = 0;
}
/** Pad or truncate to a fixed width, as a tape header field would. */
function field(str, width) {
    const s = str.length > width ? str.slice(0, width) : str;
    return s + " ".repeat(width - s.length);
}
function rightField(str, width) {
    const s = str.length > width ? str.slice(0, width) : str;
    return " ".repeat(width - s.length) + s;
}
/**
 * In authentic mode everything is 48K, because on this machine
 * everything was. Otherwise show the real footprint, compactly.
 */
function sizeLabel(game, authentic) {
    if (authentic)
        return "48K";
    const bytes = game.sizeOnDisk;
    if (bytes <= 0)
        return "";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1)
        return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)}G`;
    const mb = bytes / (1024 * 1024);
    return `${Math.max(1, Math.round(mb))}M`;
}
function tapeName(game, authentic, limit) {
    const clean = game.name.replace(/[^\x20-\x7e]/g, "").trim() || "UNTITLED";
    const upper = clean.toUpperCase();
    if (!authentic || limit === null)
        return upper;
    return upper.slice(0, limit);
}
/* ------------------------------------------------------------------ *
 * Screens                                                             *
 * ------------------------------------------------------------------ */
function drawMenu$2(d, selected) {
    resetAttributes$2(d);
    d.cls();
    // Machine label, top-left, black on white.
    d.bigText("+2", 4, 2, 3);
    // Top-right diagonal rainbow, cell-blocky as the hardware draws it.
    for (let r = 0; r <= 2; r++) {
        for (let c = 21; c <= 31; c++) {
            d.attrRect(c, r, c, r, 0, STRIPE[(c - 21 + r) % STRIPE.length], 1);
        }
    }
    const mx = 12;
    const stride = 3;
    const top = 5;
    for (let i = 0; i < MENU$2.length; i++) {
        const r0 = top + i * stride;
        const r1 = r0 + stride - 1;
        if (i === selected)
            d.attrRect(0, r0, d.cols - 1, r1, 0, 5, 1);
        d.bigText(MENU$2[i].label, mx, r0 * 8 + 4, 2);
    }
    d.setAttributes({ ink: 0, paper: 7, bright: 0 });
    d.say(22, 0, " \u00a9 1986 Amstrad plc");
    d.say(23, 0, " \u00a9 1986 Sinclair Research Ltd");
}
function drawCatalogue$2(d, view) {
    resetAttributes$2(d);
    d.cls();
    const { games, selected, scroll, authentic } = view;
    // Header bar: white on black, full width.
    d.attrRect(0, 0, d.cols - 1, 0, 7, 0, 1);
    d.setAttributes({ ink: 7, paper: 0, bright: 1 });
    d.say(0, 0, field(" Tape  Loader", 22) + field(`${games.length} prog`, 10));
    d.setAttributes({ ink: 0, paper: 7, bright: 0 });
    if (games.length === 0) {
        d.say(4, 2, "No programs on this tape.");
        d.say(6, 2, "Install something first, or");
        d.say(7, 2, "enable non-Steam shortcuts");
        d.say(8, 2, "in Options.");
        d.setAttributes({ ink: 1 });
        d.say(23, 0, " B Menu");
        return;
    }
    // Fixed 32-column grid: gutter 1, name 17, type 8, size 6. The name
    // field is the same width in both modes so the columns do not shift
    // when authentic mode is toggled — only the content shortens.
    for (let i = 0; i < CATALOGUE_ROWS$2; i++) {
        const idx = scroll + i;
        if (idx >= games.length)
            break;
        const g = games[idx];
        const row = 2 + i;
        if (idx === selected) {
            d.attrRect(0, row, d.cols - 1, row, 7, 0, 1);
            d.setAttributes({ ink: 7, paper: 0, bright: 1 });
        }
        else {
            d.setAttributes({ ink: 0, paper: 7, bright: 0 });
        }
        const name = field(tapeName(g, authentic, 10), 17);
        const type = field(g.nonSteam ? "Bytes" : "Program", 8);
        d.say(row, 0, " " + name + type + rightField(sizeLabel(g, authentic), 6));
    }
    // Scroll indicator.
    if (games.length > CATALOGUE_ROWS$2) {
        d.setAttributes({ ink: 1, paper: 7, bright: 0 });
        if (scroll > 0)
            d.say(2, 31, "\u0018");
        if (scroll + CATALOGUE_ROWS$2 < games.length)
            d.say(21, 31, "\u0019");
    }
    d.setAttributes({ ink: 1, paper: 7, bright: 0 });
    d.say(23, 0, " A LOAD    B Menu    Y Authentic");
}
function drawDiagnostics$2(d, diag) {
    resetAttributes$2(d);
    d.cls();
    d.attrRect(0, 0, d.cols - 1, 0, 7, 0, 1);
    d.setAttributes({ ink: 7, paper: 0, bright: 1 });
    d.say(0, 0, field(" Tape  Tester", 32));
    d.setAttributes({ ink: 0, paper: 7, bright: 0 });
    const mins = Math.floor(diag.uptimeSeconds / 60);
    const secs = diag.uptimeSeconds % 60;
    const battery = diag.batteryPercent === null ? "unavailable" : `${diag.batteryPercent}%${diag.charging ? " charging" : ""}`;
    const lines = [
        ["Signal level", "OK"],
        ["Tape speed", "1500 baud"],
        ["Battery", battery],
        ["Session", `${mins}m ${secs}s`],
        ["Programs", `${diag.gameCount}`],
        ["Azimuth", "aligned"],
    ];
    lines.forEach(([k, v], i) => {
        d.say(3 + i * 2, 2, field(k, 16) + v);
    });
    d.setAttributes({ ink: 4, bright: 1 });
    d.say(18, 2, "Tape signal is good.");
    d.setAttributes({ ink: 1, paper: 7, bright: 0 });
    d.say(23, 0, " B Menu");
}
function drawAbout$2(d, version) {
    resetAttributes$2(d);
    d.cls();
    d.say(0, 0, "\u00a9 1982 Sinclair Research Ltd");
    d.printAt(2, 0);
    d.print("Retro Loader " + version);
    d.newline();
    d.newline();
    d.print("A Decky Loader plugin that ");
    d.print("makes launching a game take ");
    d.print("as long as it did in 1986.");
    d.newline();
    d.newline();
    d.print("Built on the Ayrshire Pixels ");
    d.print("ZX Spectrum +2 OS recreation.");
    d.newline();
    d.newline();
    d.print("Themes are pluggable - see ");
    d.print("src/themes/types.ts.");
    d.newline();
    d.newline();
    d.setAttributes({ ink: 2, bright: 1 });
    d.print("Not affiliated with Sky, ");
    d.print("Amstrad or Valve.");
    d.setAttributes({ ink: 1, paper: 7, bright: 0 });
    d.say(23, 0, " B Menu");
}
function drawSettings$2(d, rows, selected) {
    resetAttributes$2(d);
    d.cls();
    d.attrRect(0, 0, d.cols - 1, 0, 7, 0, 1);
    d.setAttributes({ ink: 7, paper: 0, bright: 1 });
    d.say(0, 0, field(" Options", 32));
    rows.forEach((row, i) => {
        const r = 3 + i * 2;
        if (i === selected) {
            d.attrRect(0, r, d.cols - 1, r, 7, 0, 1);
            d.setAttributes({ ink: 7, paper: 0, bright: 1 });
        }
        else {
            d.setAttributes({ ink: 0, paper: 7, bright: 0 });
        }
        d.say(r, 0, " " + field(row.label, 17) + field(row.value, 14));
    });
    d.setAttributes({ ink: 1, paper: 7, bright: 0 });
    d.say(21, 2, "Left/Right to change.");
    d.say(23, 0, " A Toggle    B Menu");
}
/* ------------------------------------------------------------------ *
 * Loading                                                             *
 *                                                                     *
 * A real SCREEN$ loads bitmap first, in the Spectrum's interlaced     *
 * address order, with the attribute block arriving last. That is why  *
 * loading screens fill in stripes and then snap into colour. We do    *
 * the same: render a title card into a shadow buffer, then reveal it  *
 * byte by byte using the genuine address arithmetic.                  *
 * ------------------------------------------------------------------ */
let shadowPix = null;
let shadowAttr = null;
function beginLoad$2(d, game, authentic) {
    const { width, height } = d.geom;
    // Compose the title card into the live buffer, then steal it.
    resetAttributes$2(d);
    d.paper = 0;
    d.ink = 7;
    d.bright = 1;
    d.cls();
    const name = tapeName(game, authentic, 10);
    const scale = name.length <= 8 ? 3 : name.length <= 13 ? 2 : 1;
    const w = d.bigTextWidth(name, scale);
    const x = Math.max(0, Math.floor((width - w) / 2));
    const y = Math.floor(height / 2) - 4 * scale;
    d.bigText(name, x, y, scale);
    // Rainbow attribute bands behind the title, plus a black surround.
    const titleRow = Math.floor(y / 8);
    const titleRows = Math.ceil((8 * scale) / 8);
    for (let r = 0; r < titleRows; r++) {
        for (let c = 0; c < d.cols; c++) {
            d.attrRect(c, titleRow + r, c, titleRow + r, STRIPE[(c + r) % STRIPE.length], 0, 1);
        }
    }
    shadowPix = d.pix.slice();
    shadowAttr = d.attr.slice();
    // Now blank the display for the load to fill in.
    resetAttributes$2(d);
    d.paper = 0;
    d.ink = 7;
    d.bright = 0;
    d.cls();
}
function drawLoadFrame$2(d, game, progress, elapsedMs) {
    const { width } = d.geom;
    // Border stripes: blue/yellow pilot shimmer, then red/cyan data.
    const f = Math.floor(elapsedMs / 28);
    d.border = progress < 0.35 ? (f & 1 ? 6 : 1) : f & 1 ? 2 : 5;
    if (!shadowPix || !shadowAttr)
        return;
    // Bitmap fills over the first 90%, attributes snap in at the end.
    const bitmapProgress = Math.min(1, progress / 0.9);
    const bytesLoaded = Math.floor(bitmapProgress * 6144);
    for (let y = 0; y < 192; y++) {
        const base = ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);
        for (let bx = 0; bx < 32; bx++) {
            if (base + bx >= bytesLoaded)
                continue;
            const off = y * width + bx * 8;
            for (let bit = 0; bit < 8; bit++)
                d.pix[off + bit] = shadowPix[off + bit];
        }
    }
    if (progress >= 0.9) {
        const attrCount = Math.floor(((progress - 0.9) / 0.1) * shadowAttr.length);
        for (let i = 0; i < attrCount && i < shadowAttr.length; i++)
            d.attr[i] = shadowAttr[i];
    }
}
function drawLoadError$2(d) {
    resetAttributes$2(d);
    d.border = 7;
    d.setAttributes({ ink: 0, paper: 7, bright: 0 });
    d.printAt(d.rows - 1, 0);
    d.print("R Tape loading error, 0:1");
}
const spectrumTheme = {
    id: "spectrum",
    name: "ZX Spectrum +2",
    blurb: "Grey wedge, rainbow stripes, 1500 baud",
    launchLabel: "Insert tape",
    errorToast: "R Tape loading error, 0:1",
    soundProfile: "tape",
    geometry: GEOMETRY$2,
    palette: PALETTE$2,
    buildFont: buildFont$2,
    resetAttributes: resetAttributes$2,
    nameLimit: 10,
    menu: MENU$2,
    pilotMs: 2500,
    dataMs: 7500,
    catalogueRows: CATALOGUE_ROWS$2,
    drawMenu: drawMenu$2,
    drawCatalogue: drawCatalogue$2,
    drawDiagnostics: drawDiagnostics$2,
    drawAbout: drawAbout$2,
    drawSettings: drawSettings$2,
    beginLoad: beginLoad$2,
    drawLoadFrame: drawLoadFrame$2,
    drawLoadError: drawLoadError$2,
};

/* ------------------------------------------------------------------ *
 * Teletext theme.
 *
 * 40x25 in a 16x16 cell, 640x400, scaling 2x to fill the panel.
 * Chunky, which is correct — teletext was always chunky.
 *
 * The character repertoire is an ETSI standard rather than any
 * manufacturer's ROM, and the 2x3 mosaic graphics are generated here
 * from first principles, so this is the cleanest of the themes
 * legally. The one borrowed thing is the alphanumeric letterforms,
 * which are the Spectrum's doubled up.
 *
 * The wait is the point. A page you have requested sitting there
 * while the header cycles is the same joke as a pilot tone, and it is
 * a joke the BBC shipped to eighteen million households.
 * ------------------------------------------------------------------ */
const GEOMETRY$1 = {
    width: 640,
    height: 400,
    cellW: 16,
    cellH: 16,
    borderX: 0,
    borderY: 0,
};
/* Teletext has seven colours and black. Fully saturated, no shades —
   that is why it looks the way it looks. */
const TTX = [
    [0, 0, 0],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
];
const PALETTE$1 = TTX.map((c) => [c, c]);
const BLACK$1 = 0;
const RED = 1;
const GREEN$1 = 2;
const YELLOW = 3;
const BLUE = 4;
const MAGENTA = 5;
const CYAN = 6;
const WHITE = 7;
const MOSAIC_BASE = 0x80;
const CATALOGUE_ROWS$1 = 14;
function buildFont$1() {
    const chars = buildAt(16, 16);
    const blocks = mosaic2x3(16, 16);
    for (const g in blocks)
        chars[MOSAIC_BASE + Number(g)] = blocks[g];
    return chars;
}
const MENU$1 = [
    { label: "GAMES INDEX", action: "catalogue" },
    { label: "SIGNAL TEST", action: "diagnostics" },
    { label: "SETUP", action: "settings" },
    { label: "ABOUT", action: "about" },
    { label: "CLOSEDOWN", action: "exit" },
];
const PAGE_FOR = {
    catalogue: "101",
    diagnostics: "102",
    settings: "103",
    about: "104",
    exit: "900",
};
function resetAttributes$1(d) {
    d.border = BLACK$1;
    d.paper = BLACK$1;
    d.ink = WHITE;
    d.bright = 0;
    d.flash = 0;
    d.inverse = 0;
    d.over = 0;
}
function ink(d, colour, paper = BLACK$1) {
    d.setAttributes({ ink: colour, paper });
}
function highlight(d, row, colour = CYAN) {
    d.attrRect(0, row, d.cols - 1, row, BLACK$1, colour, 0);
    d.setAttributes({ ink: BLACK$1, paper: colour });
}
/** The header strip: page number, service name, clock. */
function header(d, page, title) {
    ink(d, WHITE);
    d.say(0, 0, field$1(`P${page}`, 6));
    ink(d, CYAN);
    d.print(field$1(title, 20));
    ink(d, WHITE);
    d.print(rightField$1("Sat 26 Jul", 14));
}
/** Double-height coloured banner, the way every teletext page opens. */
function banner$1(d, text, colour, row) {
    ink(d, colour);
    const w = d.bigTextWidth(text, 2);
    d.bigText(text, Math.max(0, Math.floor((d.geom.width - w) / 2)), row * 16, 2);
    const cells = Math.ceil(w / 16);
    const start = Math.max(0, Math.floor((d.cols - cells) / 2));
    d.attrRect(start, row, start + cells - 1, row + 1, colour, BLACK$1, 0);
}
/** The four-colour fastext bar along the bottom. */
function fastext(d, labels) {
    const colours = [RED, GREEN$1, YELLOW, CYAN];
    const w = Math.floor(d.cols / 4);
    labels.forEach((label, i) => {
        const from = i * w;
        const to = i === 3 ? d.cols - 1 : from + w - 1;
        d.attrRect(from, 24, to, 24, BLACK$1, colours[i], 0);
        d.setAttributes({ ink: BLACK$1, paper: colours[i] });
        d.say(24, from, centre(label, to - from + 1));
    });
}
/** A row of mosaic blocks, for rules and test patterns. */
function mosaicRow(d, row, colour, pattern = 63) {
    ink(d, colour);
    for (let c = 0; c < d.cols; c++)
        d.putGlyph(MOSAIC_BASE + pattern, c, row);
}
function pageName(game, authentic) {
    const upper = game.name.toUpperCase();
    // A teletext row is forty columns, but every colour change eats one
    // of them as a control code. Authentic mode pays that cost.
    return authentic ? upper.slice(0, 22) : upper.slice(0, 30);
}
/* ------------------------------------------------------------------ *
 * Screens                                                             *
 * ------------------------------------------------------------------ */
function drawMenu$1(d, selected) {
    resetAttributes$1(d);
    d.cls();
    header(d, "100", "AYRSHIRE PIXELS");
    banner$1(d, "DECK TEXT", YELLOW, 2);
    mosaicRow(d, 4, BLUE);
    ink(d, GREEN$1);
    d.say(6, 1, "INDEX");
    MENU$1.forEach((entry, i) => {
        const row = 8 + i * 2;
        if (i === selected)
            highlight(d, row);
        else
            ink(d, i === MENU$1.length - 1 ? MAGENTA : WHITE);
        d.say(row, 0, " " + leader(entry.label, PAGE_FOR[entry.action], d.cols - 2));
    });
    mosaicRow(d, 20, BLUE);
    ink(d, CYAN);
    d.say(22, 1, "SELECT A PAGE AND PRESS A");
    fastext(d, ["INDEX", "GAMES", "SETUP", "EXIT"]);
}
function drawCatalogue$1(d, view) {
    resetAttributes$1(d);
    d.cls();
    header(d, "101", "GAMES INDEX");
    banner$1(d, "GAMES", GREEN$1, 2);
    const { games, selected, scroll, authentic } = view;
    if (games.length === 0) {
        ink(d, RED);
        d.say(6, 1, "NO PAGES AVAILABLE");
        ink(d, WHITE);
        d.say(8, 1, "NOTHING INSTALLED. SEE SETUP TO");
        d.say(9, 1, "INCLUDE NON-STEAM SHORTCUTS.");
        fastext(d, ["INDEX", "GAMES", "SETUP", "EXIT"]);
        return;
    }
    for (let i = 0; i < CATALOGUE_ROWS$1; i++) {
        const idx = scroll + i;
        if (idx >= games.length)
            break;
        const g = games[idx];
        const row = 5 + i;
        if (idx === selected)
            highlight(d, row);
        else
            ink(d, g.nonSteam ? YELLOW : WHITE);
        d.say(row, 0, " " + leader(pageName(g, authentic), `${201 + idx}`, d.cols - 2));
    }
    mosaicRow(d, 20, BLUE);
    ink(d, CYAN);
    d.say(22, 1, `${games.length} PAGES`);
    ink(d, WHITE);
    d.print("   A=VIEW  B=BACK  Y=NAMES");
    fastext(d, ["INDEX", "GAMES", "SETUP", "EXIT"]);
}
function drawDiagnostics$1(d, diag) {
    resetAttributes$1(d);
    d.cls();
    header(d, "102", "SIGNAL TEST");
    // Colour bars, because what else would a test page have.
    const bars = [WHITE, YELLOW, CYAN, GREEN$1, MAGENTA, RED, BLUE];
    const w = Math.floor(d.cols / bars.length);
    bars.forEach((colour, i) => {
        const from = i * w;
        const to = i === bars.length - 1 ? d.cols - 1 : from + w - 1;
        ink(d, colour);
        for (let r = 2; r <= 7; r++)
            for (let c = from; c <= to; c++)
                d.putGlyph(MOSAIC_BASE + 63, c, r);
    });
    const mins = Math.floor(diag.uptimeSeconds / 60);
    const secs = diag.uptimeSeconds % 60;
    const rows = [
        ["SIGNAL", "GOOD"],
        ["PAGES HELD", `${diag.gameCount}`],
        ["BATTERY", diag.batteryPercent === null ? "N/A" : `${diag.batteryPercent}%`],
        ["ON AIR", `${mins}M ${secs}S`],
    ];
    rows.forEach(([k, v], i) => {
        ink(d, CYAN);
        d.say(10 + i * 2, 1, field$1(k, 16));
        ink(d, WHITE);
        d.print(v);
    });
    ink(d, GREEN$1);
    d.say(19, 1, "TRANSMISSION NORMAL");
    fastext(d, ["INDEX", "GAMES", "SETUP", "EXIT"]);
}
function drawSettings$1(d, rows, selected) {
    resetAttributes$1(d);
    d.cls();
    header(d, "103", "SETUP");
    banner$1(d, "SETUP", CYAN, 2);
    rows.forEach((row, i) => {
        const r = 6 + i * 2;
        if (i === selected)
            highlight(d, r);
        else
            ink(d, WHITE);
        d.say(r, 0, " " + leader(row.label.toUpperCase(), row.value.toUpperCase(), d.cols - 2, " "));
    });
    mosaicRow(d, 19, BLUE);
    ink(d, CYAN);
    d.say(21, 1, "LEFT/RIGHT TO CHANGE");
    d.say(22, 1, "A=TOGGLE   B=INDEX");
    fastext(d, ["INDEX", "GAMES", "SETUP", "EXIT"]);
}
function drawAbout$1(d, version) {
    resetAttributes$1(d);
    d.cls();
    header(d, "104", "ABOUT");
    banner$1(d, "ABOUT", MAGENTA, 2);
    const lines = [
        [WHITE, `RETRO LOADER ${version}`],
        [BLACK$1, ""],
        [CYAN, "A DECKY LOADER PLUGIN THAT MAKES"],
        [CYAN, "LAUNCHING A GAME TAKE AS LONG AS"],
        [CYAN, "IT DID IN 1986."],
        [BLACK$1, ""],
        [WHITE, "THE MOSAIC GRAPHICS HERE ARE"],
        [WHITE, "GENERATED, NOT COPIED. THE LETTERS"],
        [WHITE, "ARE THE SPECTRUM SET, DOUBLED."],
        [BLACK$1, ""],
        [GREEN$1, "SEE SRC/THEMES/TYPES.TS TO ADD"],
        [GREEN$1, "YOUR OWN MACHINE."],
    ];
    lines.forEach(([colour, line], i) => {
        if (!line)
            return;
        ink(d, colour);
        d.say(5 + i, 1, line);
    });
    fastext(d, ["INDEX", "GAMES", "SETUP", "EXIT"]);
}
/* ------------------------------------------------------------------ *
 * Loading                                                             *
 *                                                                     *
 * You typed a page number and the header cycled while the carousel    *
 * came round to it. There was no progress bar. There was no way to    *
 * hurry it. You just watched the digits.                              *
 * ------------------------------------------------------------------ */
function beginLoad$1() {
    /* stateless */
}
function drawLoadFrame$1(d, game, progress, elapsedMs) {
    resetAttributes$1(d);
    d.cls();
    const target = "201";
    const settled = progress >= 0.92;
    const spin = Math.floor(elapsedMs / 90);
    const scrambled = settled
        ? target
        : `${(spin % 9) + 1}${(spin * 7) % 10}${(spin * 3) % 10}`;
    header(d, scrambled, settled ? pageName(game, true).slice(0, 20) : "SEARCHING");
    if (!settled) {
        // The previous page stays on screen while you wait. That is what
        // made it feel so long: nothing changed except the digits.
        banner$1(d, "GAMES", GREEN$1, 2);
        ink(d, WHITE);
        d.say(6, 1, "PAGE " + target + " REQUESTED");
        mosaicRow(d, 8, BLUE);
        ink(d, CYAN);
        d.say(10, 1, "PLEASE WAIT");
        const dots = Math.floor(elapsedMs / 300) % 4;
        d.print(".".repeat(dots));
        fastext(d, ["INDEX", "GAMES", "SETUP", "EXIT"]);
        return;
    }
    banner$1(d, pageName(game, true).slice(0, 12), YELLOW, 2);
    mosaicRow(d, 5, RED);
    ink(d, WHITE);
    d.say(8, 1, "NOW LOADING");
    ink(d, GREEN$1);
    d.say(10, 1, pageName(game, false));
    mosaicRow(d, 13, RED);
    fastext(d, ["INDEX", "GAMES", "SETUP", "EXIT"]);
}
function drawLoadError$1(d) {
    resetAttributes$1(d);
    d.cls();
    header(d, "201", "SEARCHING");
    banner$1(d, "SORRY", RED, 4);
    ink(d, WHITE);
    d.say(8, 1, "PAGE NOT AVAILABLE");
    ink(d, CYAN);
    d.say(10, 1, "PLEASE SELECT ANOTHER PAGE");
    fastext(d, ["INDEX", "GAMES", "SETUP", "EXIT"]);
}
const teletextTheme = {
    id: "teletext",
    name: "Teletext",
    blurb: "Mode 7, fastext bar, P101 and a long wait",
    launchLabel: "Switch on",
    errorToast: "PAGE NOT AVAILABLE",
    soundProfile: "silent",
    geometry: GEOMETRY$1,
    palette: PALETTE$1,
    buildFont: buildFont$1,
    resetAttributes: resetAttributes$1,
    nameLimit: 22,
    menu: MENU$1,
    pilotMs: 4000,
    dataMs: 6000,
    catalogueRows: CATALOGUE_ROWS$1,
    drawMenu: drawMenu$1,
    drawCatalogue: drawCatalogue$1,
    drawDiagnostics: drawDiagnostics$1,
    drawAbout: drawAbout$1,
    drawSettings: drawSettings$1,
    beginLoad: beginLoad$1,
    drawLoadFrame: drawLoadFrame$1,
    drawLoadError: drawLoadError$1,
};

/* ------------------------------------------------------------------ *
 * VT100 theme.
 *
 * 80x24 in an 8x16 cell, 640x384. Monochrome, so this is the one
 * theme that uses the display's brightness bit for what it was
 * actually for: dim text and bold text off one colour.
 *
 * Legally the simplest of the lot — no manufacturer's character ROM,
 * no palette to copy, and the box-drawing glyphs are generated. The
 * authentic-name limit is fourteen characters, which is not a joke I
 * invented: that was the filename limit on System V before BSD's fast
 * filesystem lifted it.
 * ------------------------------------------------------------------ */
const GEOMETRY = {
    width: 640,
    height: 384,
    cellW: 8,
    cellH: 16,
    borderX: 0,
    borderY: 0,
};
/* Phosphor, not colour. Index 1 carries the dim/bold pair; index 2 is
   the dimmer shade used for chrome. */
const PALETTE = [
    [
        [0, 0, 0],
        [0, 0, 0],
    ],
    [
        [46, 176, 88],
        [130, 255, 150],
    ],
    [
        [24, 92, 46],
        [46, 176, 88],
    ],
];
const BLACK = 0;
const GREEN = 1;
const DIM = 2;
const CATALOGUE_ROWS = 14;
function buildFont() {
    return buildAt(8, 16);
}
const MENU = [
    { label: "games", action: "catalogue" },
    { label: "diag", action: "diagnostics" },
    { label: "setup", action: "settings" },
    { label: "about", action: "about" },
    { label: "logout", action: "exit" },
];
function resetAttributes(d) {
    d.border = BLACK;
    d.paper = BLACK;
    d.ink = GREEN;
    d.bright = 0;
    d.flash = 0;
    d.inverse = 0;
    d.over = 0;
}
function dim(d) {
    d.setAttributes({ ink: DIM, paper: BLACK, bright: 0 });
}
function normal(d) {
    d.setAttributes({ ink: GREEN, paper: BLACK, bright: 0 });
}
function bold(d) {
    d.setAttributes({ ink: GREEN, paper: BLACK, bright: 1 });
}
/** Reverse video, which on a phosphor terminal means green paper. */
function reverse(d, row, from, to) {
    d.attrRect(from, row, to, row, BLACK, GREEN, 1);
    d.setAttributes({ ink: BLACK, paper: GREEN, bright: 1 });
}
function cursor(d, row, col) {
    d.attrRect(col, row, col, row, GREEN, GREEN, 1);
    d.say(row, col, " ");
}
function box(d, x0, y0, x1, y1) {
    dim(d);
    d.putGlyph(BOX.TL, x0, y0);
    d.putGlyph(BOX.TR, x1, y0);
    d.putGlyph(BOX.BL, x0, y1);
    d.putGlyph(BOX.BR, x1, y1);
    for (let c = x0 + 1; c < x1; c++) {
        d.putGlyph(BOX.H, c, y0);
        d.putGlyph(BOX.H, c, y1);
    }
    for (let r = y0 + 1; r < y1; r++) {
        d.putGlyph(BOX.V, x0, r);
        d.putGlyph(BOX.V, x1, r);
    }
}
/** Lowercase, hyphenated, and fourteen characters if you are strict. */
function unixName(game, authentic) {
    const slug = game.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "game";
    return authentic ? slug.slice(0, 14) : slug.slice(0, 34);
}
function banner(d) {
    dim(d);
    d.say(0, 0, "Ayrshire Pixels Systems (deck)  ttyS0");
    normal(d);
    d.say(2, 0, "deck login: ");
    bold(d);
    d.print("chris");
    normal(d);
    d.say(3, 0, "Password:");
    dim(d);
    d.say(4, 0, "Last login: Sat Jul 26 17:05:12 on ttyS0");
}
/* ------------------------------------------------------------------ *
 * Screens                                                             *
 * ------------------------------------------------------------------ */
function drawMenu(d, selected) {
    resetAttributes(d);
    d.cls();
    banner(d);
    normal(d);
    d.say(6, 0, "$ menu");
    const x0 = 4;
    const x1 = 43;
    box(d, x0, 8, x1, 16);
    bold(d);
    d.say(9, x0 + 2, "DECK TERMINAL");
    dim(d);
    for (let c = x0 + 1; c < x1; c++)
        d.putGlyph(BOX.H, c, 10);
    d.putGlyph(BOX.TEE_L, x0, 10);
    d.putGlyph(BOX.TEE_R, x1, 10);
    MENU.forEach((entry, i) => {
        const row = 11 + i;
        if (i === selected) {
            reverse(d, row, x0 + 1, x1 - 1);
            d.say(row, x0 + 1, field$1(` ${entry.label}`, x1 - x0 - 1));
        }
        else {
            normal(d);
            d.say(row, x0 + 2, field$1(entry.label, x1 - x0 - 3));
        }
    });
    normal(d);
    d.say(18, 0, "$ ");
    cursor(d, 18, 2);
}
function drawCatalogue(d, view) {
    resetAttributes(d);
    d.cls();
    const { games, selected, scroll, authentic } = view;
    normal(d);
    d.say(0, 0, "$ ls -l /usr/games");
    if (games.length === 0) {
        d.say(2, 0, "ls: /usr/games: No such file or directory");
        dim(d);
        d.say(4, 0, "Nothing installed. Try setup to include");
        d.say(5, 0, "non-Steam shortcuts.");
        d.say(23, 0, " a run   b back   y names");
        return;
    }
    const total = games.reduce((n, g) => n + g.sizeOnDisk, 0);
    dim(d);
    d.say(1, 0, `total ${Math.round(total / 1024)}`);
    for (let i = 0; i < CATALOGUE_ROWS; i++) {
        const idx = scroll + i;
        if (idx >= games.length)
            break;
        const g = games[idx];
        const row = 2 + i;
        if (idx === selected)
            reverse(d, row, 0, d.cols - 1);
        else
            normal(d);
        // A non-Steam shortcut really is a symlink, so list it as one.
        const mode = g.nonSteam ? "lrwxrwxrwx" : "-rwxr-xr-x";
        const line = `${mode}  1 chris games ` +
            rightField$1(`${g.sizeOnDisk}`, 12) +
            " Jul 26 17:05 " +
            unixName(g, authentic);
        d.say(row, 0, field$1(line, d.cols));
    }
    normal(d);
    d.say(18, 0, "$ ");
    cursor(d, 18, 2);
    dim(d);
    d.say(23, 0, ` ${games.length} files   a run   b back   y names`);
}
function drawDiagnostics(d, diag) {
    resetAttributes(d);
    d.cls();
    const mins = Math.floor(diag.uptimeSeconds / 60);
    const secs = diag.uptimeSeconds % 60;
    normal(d);
    d.say(0, 0, "$ uptime");
    bold(d);
    d.say(1, 0, ` 17:05:12 up ${mins}m ${secs}s,  1 user,  load average: 0.08, 0.03, 0.01`);
    normal(d);
    d.say(3, 0, "$ dmesg | tail");
    dim(d);
    const log = [
        "[    0.000000] Booting deck kernel",
        "[    0.412000] tty0: VT100 emulation enabled",
        "[    1.004000] tape0: no cassette present",
        `[    1.220000] games: ${diag.gameCount} executables registered`,
        `[    1.480000] battery: ${diag.batteryPercent === null ? "unknown" : diag.batteryPercent + "%"}${diag.charging ? " charging" : ""}`,
        "[    1.900000] all subsystems nominal",
    ];
    log.forEach((line, i) => d.say(4 + i, 0, line));
    normal(d);
    d.say(12, 0, "$ ");
    cursor(d, 12, 2);
    dim(d);
    d.say(23, 0, " b back");
}
function drawSettings(d, rows, selected) {
    resetAttributes(d);
    d.cls();
    normal(d);
    d.say(0, 0, "$ setup");
    const x0 = 2;
    const x1 = 55;
    box(d, x0, 2, x1, 4 + rows.length * 2);
    bold(d);
    d.say(3, x0 + 2, "configuration");
    rows.forEach((row, i) => {
        const r = 5 + i * 2;
        if (i === selected) {
            reverse(d, r, x0 + 1, x1 - 1);
            d.say(r, x0 + 1, " " + field$1(row.label.toLowerCase(), 26) + field$1(row.value.toLowerCase(), 24));
        }
        else {
            normal(d);
            d.say(r, x0 + 2, field$1(row.label.toLowerCase(), 26));
            dim(d);
            d.print(field$1(row.value.toLowerCase(), 23));
        }
    });
    normal(d);
    d.say(4 + rows.length * 2 + 2, 0, "$ ");
    cursor(d, 4 + rows.length * 2 + 2, 2);
    dim(d);
    d.say(22, 0, " arrow keys change values");
    d.say(23, 0, " a toggle   b back");
}
function drawAbout(d, version) {
    resetAttributes(d);
    d.cls();
    normal(d);
    d.say(0, 0, "$ cat README");
    const lines = [
        `retro-loader ${version}`,
        "",
        "A Decky Loader plugin that makes launching a game take as",
        "long as it did in 1986.",
        "",
        "This theme borrows no character ROM and no palette. The box",
        "glyphs are generated from an up/down/left/right mask.",
        "",
        "The fourteen-character name limit is not invented either: that",
        "was System V, before the fast filesystem lifted it.",
        "",
        "See src/themes/types.ts to add your own machine.",
    ];
    lines.forEach((line, i) => {
        if (i === 0)
            bold(d);
        else
            normal(d);
        d.say(2 + i, 0, line);
    });
    normal(d);
    d.say(16, 0, "$ ");
    cursor(d, 16, 2);
    dim(d);
    d.say(23, 0, " b back");
}
/* ------------------------------------------------------------------ *
 * Loading                                                             *
 *                                                                     *
 * A teletype at 300 baud delivered about thirty characters a second,
 * so you watched output arrive letter by letter. That is the wait,
 * and unlike the other machines it needs no animation at all — just
 * a substring of the final text, indexed by progress.
 * ------------------------------------------------------------------ */
function beginLoad() {
    /* stateless */
}
function drawLoadFrame(d, game, progress) {
    resetAttributes(d);
    d.cls();
    const name = unixName(game, false);
    const script = [
        `$ ./${name}`,
        "",
        "checking tape device ......... ok",
        "rewinding /dev/tape0 ......... ok",
        "reading header ............... ok",
        "loading modules .............. ok",
        "initialising display ......... ok",
        "mounting /usr/games .......... ok",
        "",
        `starting ${name}`,
    ];
    const full = script.join("\n");
    const shown = full.slice(0, Math.floor(progress * full.length));
    const lines = shown.split("\n");
    lines.forEach((line, i) => {
        if (i === 0 || i === lines.length - 1)
            bold(d);
        else
            normal(d);
        d.say(i, 0, line);
    });
    cursor(d, Math.min(d.rows - 1, lines.length - 1), lines[lines.length - 1].length);
}
function drawLoadError(d) {
    resetAttributes(d);
    d.cls();
    normal(d);
    d.say(0, 0, "$ ./game");
    d.say(1, 0, "checking tape device ......... ");
    bold(d);
    d.print("^C");
    normal(d);
    d.say(3, 0, "Killed.");
    d.say(5, 0, "$ ");
    cursor(d, 5, 2);
}
const vt100Theme = {
    id: "vt100",
    name: "VT100 terminal",
    blurb: "Green phosphor, 300 baud, 14-char filenames",
    launchLabel: "Log in",
    errorToast: "Killed.",
    soundProfile: "teletype",
    geometry: GEOMETRY,
    palette: PALETTE,
    buildFont,
    resetAttributes,
    nameLimit: 14,
    menu: MENU,
    pilotMs: 2000,
    dataMs: 8000,
    catalogueRows: CATALOGUE_ROWS,
    drawMenu,
    drawCatalogue,
    drawDiagnostics,
    drawAbout,
    drawSettings,
    beginLoad,
    drawLoadFrame,
    drawLoadError,
};

/* ------------------------------------------------------------------ *
 * Theme registry.
 *
 * Add a machine by implementing Theme and pushing it into THEMES. The
 * Quick Access dropdown and the settings file both read from here, so
 * there is nothing else to wire up.
 * ------------------------------------------------------------------ */
const THEMES = [
    spectrumTheme,
    c64Theme,
    dosTheme,
    teletextTheme,
    vt100Theme,
];
const DEFAULT_THEME_ID = spectrumTheme.id;
function getTheme(id) {
    return THEMES.find((t) => t.id === id) ?? spectrumTheme;
}

/* ------------------------------------------------------------------ *
 * Settings bridge. Same shape as Game Roulette's: defaults live in
 * both halves so a partial or corrupt settings.json degrades rather
 * than throwing.
 * ------------------------------------------------------------------ */
const LOAD_SPEEDS = ["authentic", "quick", "instant"];
const defaultSettings = {
    themeId: DEFAULT_THEME_ID,
    authenticNames: true,
    includeNonSteam: false,
    sound: true,
    haptics: true,
    loadSpeed: "authentic",
};
function loadSpeedLabel(speed) {
    switch (speed) {
        case "authentic":
            return "authentic (10s)";
        case "quick":
            return "quick (4s)";
        case "instant":
            return "instant";
    }
}
const getSettingsRaw = callable("get_settings");
const setSettingsRaw = callable("set_settings");
async function loadSettings() {
    try {
        const stored = await getSettingsRaw();
        return { ...defaultSettings, ...(stored ?? {}) };
    }
    catch (err) {
        console.warn("[RetroLoader] settings read failed, using defaults", err);
        return { ...defaultSettings };
    }
}
async function saveSettings(settings) {
    try {
        await setSettingsRaw(settings);
    }
    catch (err) {
        console.warn("[RetroLoader] settings write failed", err);
    }
}

/* ------------------------------------------------------------------ *
 * Steam client access.
 *
 * Adapted from Game Roulette. Same rule applies: every reach into a
 * live Steam store is defensive, so a Valve rename degrades to an
 * empty catalogue rather than a white screen.
 * ------------------------------------------------------------------ */
const APP_TYPE_GAME = 1; // EAppType.Game
const APP_TYPE_SHORTCUT = 1073741824; // EAppType.Shortcut (non-Steam games)
function overviewToGame(app) {
    if (!app)
        return null;
    const type = Number(app.app_type ?? 0);
    const isGame = (type & APP_TYPE_GAME) !== 0;
    const isShortcut = type === APP_TYPE_SHORTCUT;
    if (type !== 0 && !isGame && !isShortcut)
        return null;
    const appid = Number(app.appid);
    if (!Number.isFinite(appid))
        return null;
    return {
        appid,
        name: String(app.display_name ?? "Unknown"),
        minutes: Number(app.minutes_playtime_forever ?? 0) || 0,
        installed: isShortcut ? true : Boolean(app.installed),
        nonSteam: isShortcut,
        sizeOnDisk: Number(app.size_on_disk ?? 0) || 0,
    };
}
/**
 * Installed games only. A catalogue listing things that are not
 * actually there would be a lie, and the joke depends on the list
 * being real.
 */
function readInstalled(includeNonSteam) {
    const store = window.collectionStore;
    const raw = store?.localGamesCollection?.allApps ?? store?.allAppsCollection?.allApps ?? [];
    const games = [];
    for (const app of raw) {
        const g = overviewToGame(app);
        if (!g)
            continue;
        if (!g.installed)
            continue;
        if (g.nonSteam && !includeNonSteam)
            continue;
        games.push(g);
    }
    games.sort((a, b) => a.name.localeCompare(b.name, "en"));
    return games;
}
function launchGame(appid, errorMessage) {
    try {
        window.SteamClient?.Apps?.RunGame(`${appid}`, "", -1, 100);
    }
    catch (err) {
        console.error("[RetroLoader] launch failed", err);
        toaster.toast({ title: "Retro Loader", body: errorMessage });
    }
}
function pulseHaptic() {
    try {
        // TriggerHapticPulse(controllerIndex, eHapticType, param2); type 2 == Click.
        window.SteamClient?.Input?.TriggerHapticPulse?.(0, 2, 0);
    }
    catch {
        /* haptics are best-effort */
    }
}
function readDiagnostics(gameCount) {
    let batteryPercent = null;
    let charging = false;
    try {
        const sys = window.SteamUIStore?.BatteryLevel;
        if (typeof sys === "number")
            batteryPercent = Math.round(sys * 100);
        const bat = window.SteamClient?.System?.GetBatteryLevel?.();
        if (batteryPercent === null && typeof bat === "number")
            batteryPercent = Math.round(bat);
        charging = Boolean(window.SteamUIStore?.BIsCharging);
    }
    catch {
        /* diagnostics are cosmetic */
    }
    return {
        batteryPercent,
        charging,
        uptimeSeconds: Math.floor(performance.now() / 1000),
        gameCount,
    };
}

const VERSION = "0.3.2";
function RetroLoader() {
    const canvasRef = SP_REACT.useRef(null);
    const wrapRef = SP_REACT.useRef(null);
    const [settings, setSettings] = SP_REACT.useState(defaultSettings);
    const [ready, setReady] = SP_REACT.useState(false);
    const theme = SP_REACT.useMemo(() => getTheme(settings.themeId), [settings.themeId]);
    const display = SP_REACT.useMemo(() => new Display(theme.geometry, theme.palette, theme.buildFont()), [theme]);
    const [games, setGames] = SP_REACT.useState([]);
    const [mode, setMode] = SP_REACT.useState("menu");
    const [menuSel, setMenuSel] = SP_REACT.useState(0);
    const [catSel, setCatSel] = SP_REACT.useState(0);
    const [catScroll, setCatScroll] = SP_REACT.useState(0);
    const [optSel, setOptSel] = SP_REACT.useState(0);
    // Load state lives in a ref so the animation loop never restarts.
    const loadRef = SP_REACT.useRef(null);
    /* ---------------- boot ---------------- */
    SP_REACT.useEffect(() => {
        let cancelled = false;
        // Show something immediately. Settings only choose the theme, so
        // waiting on the backend before drawing anything means a failed
        // or slow RPC leaves a black screen with no way to tell why.
        try {
            setGames(readInstalled(defaultSettings.includeNonSteam));
        }
        catch (err) {
            console.error("[RetroLoader] could not read the library", err);
        }
        setReady(true);
        void (async () => {
            // Never hang forever on the backend.
            const timeout = new Promise((resolve) => setTimeout(() => resolve(defaultSettings), 2000));
            const s = await Promise.race([loadSettings(), timeout]);
            if (cancelled)
                return;
            console.log("[RetroLoader] settings applied:", s.themeId);
            setSettings(s);
            try {
                setGames(readInstalled(s.includeNonSteam));
            }
            catch (err) {
                console.error("[RetroLoader] could not read the library", err);
            }
            primeAudio();
        })();
        return () => {
            cancelled = true;
            loadRef.current?.sound?.stop();
        };
    }, []);
    SP_REACT.useEffect(() => {
        if (ready)
            setGames(readInstalled(settings.includeNonSteam));
    }, [settings.includeNonSteam, ready]);
    // Machines differ in how many catalogue rows they show, so a theme
    // switch has to put the cursor back at the top or paging desyncs.
    SP_REACT.useEffect(() => {
        setCatSel(0);
        setCatScroll(0);
        setMenuSel(0);
        setMode("menu");
    }, [theme]);
    const persist = SP_REACT.useCallback((next) => {
        setSettings(next);
        void saveSettings(next);
    }, []);
    /* ---------------- options rows ---------------- */
    const optionRows = SP_REACT.useMemo(() => [
        { label: "Authentic names", value: settings.authenticNames ? "on (10 char)" : "off" },
        { label: "Load time", value: loadSpeedLabel(settings.loadSpeed) },
        { label: "Load sound", value: settings.sound ? "on" : "off" },
        { label: "Haptics", value: settings.haptics ? "on" : "off" },
        { label: "Non-Steam", value: settings.includeNonSteam ? "shown" : "hidden" },
    ], [settings]);
    const adjustOption = SP_REACT.useCallback((delta) => {
        const next = { ...settings };
        switch (optSel) {
            case 0:
                next.authenticNames = !next.authenticNames;
                break;
            case 1: {
                const i = LOAD_SPEEDS.indexOf(next.loadSpeed);
                const j = (i + delta + LOAD_SPEEDS.length) % LOAD_SPEEDS.length;
                next.loadSpeed = LOAD_SPEEDS[j];
                break;
            }
            case 2:
                next.sound = !next.sound;
                break;
            case 3:
                next.haptics = !next.haptics;
                break;
            case 4:
                next.includeNonSteam = !next.includeNonSteam;
                break;
        }
        persist(next);
    }, [optSel, settings, persist]);
    /* ---------------- load sequence ---------------- */
    const beginLoad = SP_REACT.useCallback((game) => {
        const total = settings.loadSpeed === "instant" ? 0 : theme.pilotMs + theme.dataMs;
        if (total === 0) {
            launchGame(game.appid, theme.errorToast);
            DFL.Navigation.NavigateBack();
            return;
        }
        const scale = settings.loadSpeed === "quick" ? 0.4 : 1;
        theme.beginLoad(display, game, settings.authenticNames);
        loadRef.current = {
            game,
            start: performance.now(),
            total: total * scale,
            sound: settings.sound ? playLoadSound(theme.soundProfile, theme.pilotMs * scale) : null,
            launched: false,
        };
        if (settings.haptics)
            pulseHaptic();
        setMode("loading");
    }, [display, settings, theme]);
    const finishLoad = SP_REACT.useCallback(() => {
        const state = loadRef.current;
        if (!state || state.launched)
            return;
        state.launched = true;
        state.sound?.stop();
        if (settings.haptics)
            pulseHaptic();
        launchGame(state.game.appid, theme.errorToast);
        loadRef.current = null;
        DFL.Navigation.NavigateBack();
    }, [settings.haptics, theme.errorToast]);
    const abortLoad = SP_REACT.useCallback(() => {
        const state = loadRef.current;
        if (!state)
            return;
        state.sound?.stop();
        loadRef.current = null;
        theme.drawLoadError(display);
        setMode("error");
        if (settings.haptics)
            pulseHaptic();
        setTimeout(() => setMode("catalogue"), 1400);
    }, [display, theme, settings.haptics]);
    /* ---------------- input ---------------- */
    const move = SP_REACT.useCallback((delta) => {
        if (settings.sound)
            tick();
        if (mode === "menu") {
            setMenuSel((s) => (s + delta + theme.menu.length) % theme.menu.length);
            return;
        }
        if (mode === "settings") {
            setOptSel((s) => (s + delta + optionRows.length) % optionRows.length);
            return;
        }
        if (mode === "catalogue" && games.length) {
            setCatSel((s) => {
                const next = Math.max(0, Math.min(games.length - 1, s + delta));
                setCatScroll((sc) => {
                    const rows = theme.catalogueRows;
                    if (next < sc)
                        return next;
                    if (next >= sc + rows)
                        return next - rows + 1;
                    return sc;
                });
                return next;
            });
        }
    }, [mode, games.length, theme, optionRows.length, settings.sound]);
    const page = SP_REACT.useCallback((direction) => {
        if (mode !== "catalogue" || games.length === 0)
            return;
        const rows = Math.max(1, Math.min(theme.catalogueRows, games.length));
        const slot = Math.max(0, Math.min(rows - 1, catSel - catScroll));
        const maxScroll = Math.max(0, games.length - rows);
        const nextScroll = Math.max(0, Math.min(maxScroll, catScroll + direction * rows));
        if (nextScroll === catScroll)
            return;
        setCatScroll(nextScroll);
        setCatSel(Math.min(games.length - 1, nextScroll + slot));
        if (settings.sound)
            tick();
    }, [mode, games.length, theme.catalogueRows, catSel, catScroll, settings.sound]);
    const confirm = SP_REACT.useCallback(() => {
        if (mode === "loading") {
            finishLoad();
            return;
        }
        if (mode === "menu") {
            const action = theme.menu[menuSel].action;
            if (settings.sound)
                chirp();
            if (action === "exit") {
                DFL.Navigation.NavigateBack();
                return;
            }
            if (action === "catalogue")
                setGames(readInstalled(settings.includeNonSteam));
            setMode(action);
            return;
        }
        if (mode === "settings") {
            adjustOption(1);
            return;
        }
        if (mode === "catalogue" && games[catSel]) {
            if (settings.sound)
                chirp();
            beginLoad(games[catSel]);
        }
    }, [
        mode,
        menuSel,
        catSel,
        games,
        theme,
        settings.sound,
        settings.includeNonSteam,
        adjustOption,
        beginLoad,
        finishLoad,
    ]);
    const cancel = SP_REACT.useCallback(() => {
        if (mode === "loading") {
            abortLoad();
            return;
        }
        if (mode === "menu") {
            DFL.Navigation.NavigateBack();
            return;
        }
        setMode("menu");
    }, [mode, abortLoad]);
    const secondary = SP_REACT.useCallback(() => {
        if (mode === "catalogue")
            persist({ ...settings, authenticNames: !settings.authenticNames });
    }, [mode, settings, persist]);
    /**
     * Only the buttons Steam does not already handle. Up and down move
     * focus between the row elements, and A/B/Y are bound per row, so
     * handling them here as well would fire everything twice.
     */
    const onButtonDown = SP_REACT.useCallback((evt) => {
        switch (evt?.detail?.button) {
            case DFL.GamepadButton.BUMPER_LEFT:
                page(-1);
                break;
            case DFL.GamepadButton.BUMPER_RIGHT:
                page(1);
                break;
            case DFL.GamepadButton.DIR_LEFT:
                if (mode === "settings")
                    adjustOption(-1);
                break;
            case DFL.GamepadButton.DIR_RIGHT:
                if (mode === "settings")
                    adjustOption(1);
                break;
        }
    }, [page, adjustOption, mode]);
    // Keyboard, for desktop mode and for testing in a browser.
    SP_REACT.useEffect(() => {
        const onKey = (e) => {
            primeAudio();
            switch (e.key) {
                case "ArrowUp":
                    move(-1);
                    break;
                case "ArrowDown":
                    move(1);
                    break;
                case "ArrowLeft":
                    if (mode === "settings")
                        adjustOption(-1);
                    break;
                case "ArrowRight":
                    if (mode === "settings")
                        adjustOption(1);
                    break;
                case "Enter":
                    confirm();
                    break;
                case "Escape":
                case "Backspace":
                    cancel();
                    break;
                case "y":
                case "Y":
                    secondary();
                    break;
                default:
                    return;
            }
            e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [move, confirm, cancel, secondary, adjustOption, mode]);
    /* ---------------- draw loop ---------------- */
    SP_REACT.useEffect(() => {
        if (!ready)
            return;
        const canvas = canvasRef.current;
        if (!canvas) {
            console.error("[RetroLoader] no canvas element; nothing will draw");
            return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            console.error("[RetroLoader] no 2d context; nothing will draw");
            return;
        }
        console.log(`[RetroLoader] drawing ${display.frameWidth}x${display.frameHeight}`);
        ctx.imageSmoothingEnabled = false;
        let raf = 0;
        let frame = 0;
        const draw = () => {
            frame++;
            if (frame % 16 === 0)
                display.flashOn = !display.flashOn;
            const state = loadRef.current;
            if (mode === "loading" && state) {
                const elapsed = performance.now() - state.start;
                const progress = Math.min(1, elapsed / state.total);
                theme.drawLoadFrame(display, state.game, progress, elapsed);
                if (progress >= 1)
                    finishLoad();
            }
            else if (mode === "menu") {
                theme.drawMenu(display, menuSel);
            }
            else if (mode === "catalogue") {
                theme.drawCatalogue(display, {
                    games,
                    selected: catSel,
                    scroll: catScroll,
                    authentic: settings.authenticNames,
                });
            }
            else if (mode === "diagnostics") {
                theme.drawDiagnostics(display, readDiagnostics(games.length));
            }
            else if (mode === "about") {
                theme.drawAbout(display, VERSION);
            }
            else if (mode === "settings") {
                theme.drawSettings(display, optionRows, optSel);
            }
            display.render(ctx);
            if (wrapRef.current)
                wrapRef.current.style.background = display.borderCss();
            raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [
        ready,
        mode,
        menuSel,
        catSel,
        catScroll,
        optSel,
        optionRows,
        games,
        settings.authenticNames,
        display,
        theme,
        finishLoad,
    ]);
    /* ---------------- integer-scaled layout ---------------- */
    const [scale, setScale] = SP_REACT.useState(3);
    SP_REACT.useEffect(() => {
        const fit = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            const s = Math.max(1, Math.floor(Math.min(w / display.frameWidth, h / display.frameHeight)));
            setScale(s);
        };
        fit();
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }, [display]);
    /* ---------------- focus rows ---------------- */
    /**
     * How many selectable rows this screen has. Steam's navigation needs
     * a real DOM element per row: a Focusable is a *container* that
     * routes focus to focusable descendants, so one wrapping the canvas
     * has nothing to focus and never receives gamepad input at all.
     * Screens with no list still get a single row, or B would not work.
     */
    const rowCount = mode === "menu"
        ? theme.menu.length
        : mode === "settings"
            ? optionRows.length
            : mode === "catalogue"
                ? Math.max(1, Math.min(theme.catalogueRows, games.length))
                : 1;
    /** Which row currently holds focus. */
    const focusIndex = mode === "menu"
        ? menuSel
        : mode === "settings"
            ? optSel
            : mode === "catalogue"
                ? Math.max(0, Math.min(rowCount - 1, catSel - catScroll))
                : 0;
    const focusRow = SP_REACT.useCallback((i) => {
        primeAudio();
        if (mode === "menu")
            setMenuSel(i);
        else if (mode === "settings")
            setOptSel(i);
        else if (mode === "catalogue")
            setCatSel(catScroll + i);
    }, [mode, catScroll]);
    /**
     * Steam moves focus between rows itself, so we only handle the
     * edges: pressing up on the top row or down on the bottom row has
     * nowhere to go, and that is our cue to scroll the window instead.
     */
    const onDirection = SP_REACT.useCallback((evt) => {
        if (mode !== "catalogue")
            return;
        const button = evt?.detail?.button;
        if (button === DFL.GamepadButton.DIR_UP && focusIndex === 0 && catScroll > 0) {
            setCatScroll(catScroll - 1);
            setCatSel(catScroll - 1);
            if (settings.sound)
                tick();
        }
        else if (button === DFL.GamepadButton.DIR_DOWN &&
            focusIndex === rowCount - 1 &&
            catScroll + rowCount < games.length) {
            setCatScroll(catScroll + 1);
            setCatSel(catScroll + rowCount);
            if (settings.sound)
                tick();
        }
    }, [mode, focusIndex, catScroll, rowCount, games.length, settings.sound]);
    const okLabel = mode === "loading" ? "Skip" : mode === "catalogue" ? "Load" : mode === "settings" ? "Change" : "Select";
    return (SP_JSX.jsxs("div", { style: {
            position: "fixed",
            inset: 0,
            zIndex: 7000,
            overflow: "hidden",
        }, children: [SP_JSX.jsx("div", { ref: wrapRef, style: {
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#000",
                    transition: "background 60ms linear",
                }, children: SP_JSX.jsx("canvas", { ref: canvasRef, width: display.frameWidth, height: display.frameHeight, style: {
                        width: display.frameWidth * scale,
                        height: display.frameHeight * scale,
                        imageRendering: "pixelated",
                        display: "block",
                    } }) }), SP_JSX.jsx(DFL.Focusable, { "flow-children": "vertical", noFocusRing: true, style: { position: "absolute", inset: 0 }, onButtonDown: onButtonDown, onGamepadDirection: onDirection, children: Array.from({ length: rowCount }, (_, i) => (SP_JSX.jsx(DFL.Focusable, { noFocusRing: true, preferredFocus: i === focusIndex, focusClassName: "retro-loader-row", style: {
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: `${(i / rowCount) * 100}%`,
                        height: `${100 / rowCount}%`,
                        // Not opacity 0 and not pointerEvents none: a navigation
                        // system is entitled to skip elements it considers
                        // invisible, and we need these to be focus targets.
                        opacity: 0.01,
                        background: "transparent",
                    }, onGamepadFocus: () => focusRow(i), onOKButton: confirm, onCancelButton: cancel, onSecondaryButton: secondary, onOKActionDescription: okLabel, onCancelActionDescription: mode === "menu" ? "Exit" : "Back", onSecondaryActionDescription: mode === "catalogue" ? "Authentic names" : undefined, children: SP_JSX.jsx("div", { style: { width: "100%", height: "100%" } }) }, `${mode}-${i}`))) })] }));
}

/* The Decky entry module may only have a default export, so the route
   path lives here rather than in index.tsx. */
const ROUTE = "/retro-loader";

function Content() {
    const [settings, setSettings] = SP_REACT.useState(defaultSettings);
    SP_REACT.useEffect(() => {
        let cancelled = false;
        void loadSettings().then((s) => {
            if (!cancelled)
                setSettings(s);
        });
        return () => {
            cancelled = true;
        };
    }, []);
    const update = (key, value) => {
        const next = { ...settings, [key]: value };
        setSettings(next);
        void saveSettings(next);
    };
    const theme = getTheme(settings.themeId);
    const start = () => {
        DFL.Navigation.CloseSideMenus();
        DFL.Navigation.Navigate(ROUTE);
    };
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSection, { children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: start, children: theme.launchLabel }) }) }), SP_JSX.jsxs(DFL.PanelSection, { title: "Machine", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.DropdownItem, { label: "Theme", description: theme.blurb, rgOptions: THEMES.map((t) => ({ data: t.id, label: t.name })), selectedOption: settings.themeId, onChange: (o) => update("themeId", String(o.data)) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.DropdownItem, { label: "Load time", description: "How long you suffer before the game starts.", rgOptions: LOAD_SPEEDS.map((s) => ({ data: s, label: loadSpeedLabel(s) })), selectedOption: settings.loadSpeed, onChange: (o) => update("loadSpeed", o.data) }) })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Catalogue", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "Authentic names", description: `Truncate names the way this machine did (${theme.nameLimit ?? "off"}).`, checked: settings.authenticNames, onChange: (v) => update("authenticNames", v) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "Include non-Steam", checked: settings.includeNonSteam, onChange: (v) => update("includeNonSteam", v) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "Load sound", checked: settings.sound, onChange: (v) => update("sound", v) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "Haptics", checked: settings.haptics, onChange: (v) => update("haptics", v) }) })] })] }));
}
/**
 * A crash inside the full-screen route used to render as a black
 * screen with nothing to go on. Now it paints the error, in plain DOM
 * text rather than on the canvas, so it survives a failure in the
 * display code itself.
 */
class RouteBoundary extends SP_REACT.Component {
    constructor() {
        super(...arguments);
        this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        console.error("[RetroLoader] route crashed", error, info);
    }
    render() {
        if (this.state.error) {
            return (SP_JSX.jsx("div", { style: {
                    position: "fixed",
                    inset: 0,
                    zIndex: 7000,
                    background: "#101010",
                    color: "#43ac36",
                    font: "16px monospace",
                    padding: "48px",
                    whiteSpace: "pre-wrap",
                    overflow: "auto",
                }, children: `Retro Loader failed to start.\n\n${this.state.error.message}\n\n${this.state.error.stack ?? ""}\n\nPress B to go back.` }));
        }
        return this.props.children;
    }
}
/* A crash inside a Decky panel takes the whole Quick Access menu with
   it, so the panel is wrapped exactly as Game Roulette wraps its own. */
class Boundary extends SP_REACT.Component {
    constructor() {
        super(...arguments);
        this.state = { failed: false };
    }
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error) {
        console.error("[RetroLoader] panel crashed", error);
    }
    render() {
        if (this.state.failed) {
            return (SP_JSX.jsx(DFL.PanelSection, { children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: 12 }, children: "Something went wrong. Reload the plugin." }) }) }));
        }
        return this.props.children;
    }
}
var index = definePlugin(() => {
    console.log("[RetroLoader] plugin mounted, route registered at", ROUTE);
    routerHook.addRoute(ROUTE, () => (SP_JSX.jsx(RouteBoundary, { children: SP_JSX.jsx(RetroLoader, {}) })), { exact: true });
    return {
        name: "Retro Loader",
        titleView: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "Retro Loader" }),
        content: (SP_JSX.jsx(Boundary, { children: SP_JSX.jsx(Content, {}) })),
        icon: SP_JSX.jsx(CassetteIcon, {}),
        onDismount() {
            routerHook.removeRoute(ROUTE);
        },
    };
});

export { index as default };
