"""Anowa final logo package (concept 12 — Pulse). Run with /tmp/fontenv/bin/python."""
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

OUT = "/Users/isaackumi/pbafarm/docs/brand/anowa/logo"
FONT = "/tmp/geist/geist-font/GeistMono/ttf/GeistMono-Medium.ttf"
INK, SAND, CORAL, DEEP, WHITE = "#0B0D10", "#F4F0E8", "#F2A07B", "#06121C", "#FFFFFF"
SCHEMES = {  # line, dot, word
    "color": (INK, CORAL, INK),
    "reversed": (SAND, CORAL, SAND),
    "black": (INK, INK, INK),
    "white": (WHITE, WHITE, WHITE),
}

PULSE = "M14.5 34 H18 L23 19 L30 49 L36 27 L40 34 H46 L58 22 L58 46 L46 34"
MARK_BOX = (0.5, 16.25, 60.25, 35.5)  # tight bbox of the mark incl. stroke (x, y, w, h)


def mark(line, dot, dx=0, dy=0, s=1):
    return (f'<g transform="translate({dx:.2f} {dy:.2f}) scale({s:.4f})">'
            f'<path d="{PULSE}" fill="none" stroke="{line}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="4.5" cy="34" r="4" fill="{dot}"/></g>')


font = TTFont(FONT)
gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
TRACK = -0.02 * upm


def word_path(size):
    """Outline 'anowa' at font-size `size`; returns (d, width, xheight, bbox)."""
    sc, x, d = size / upm, 0, []
    xmin = ymin = 1e9; xmax = ymax = -1e9
    for ch in "anowa":
        g = gs[cmap[ord(ch)]]
        pen = SVGPathPen(gs)
        g.draw(TransformPen(pen, (sc, 0, 0, -sc, x * sc, 0)))
        d.append(pen.getCommands())
        bp = BoundsPen(gs); g.draw(bp)
        if bp.bounds:
            a, b, c, e = bp.bounds
            xmin, xmax = min(xmin, (x + a) * sc), max(xmax, (x + c) * sc)
            ymin, ymax = min(ymin, -e * sc), max(ymax, -b * sc)
        x += g.width + TRACK
    return " ".join(d), (xmin, ymin, xmax, ymax)


def svg(w, h, body, title="Anowa"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:.0f}" height="{h:.0f}" viewBox="0 0 {w:.2f} {h:.2f}" '
            f'role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n')


def build():
    os.makedirs(OUT, exist_ok=True)
    mx, my, mw, mh = MARK_BOX
    for name, (line, dot, word) in SCHEMES.items():
        # 1. Mark — square 64 grid
        open(f"{OUT}/anowa-mark-{name}.svg", "w").write(svg(64, 64, mark(line, dot)))

        # 2. Wordmark — x-height ≈ mark height × 0.62
        d, (x0, y0, x1, y1) = word_path(48)
        open(f"{OUT}/anowa-wordmark-{name}.svg", "w").write(
            svg(x1 - x0, y1 - y0, f'<path transform="translate({-x0:.2f} {-y0:.2f})" d="{d}" fill="{word}"/>'))

        # 3. Horizontal lockup — mark height = 100, gap = dot diameter × 3
        H = 100; s = H / mh; MW = mw * s
        d, (x0, y0, x1, y1) = word_path(H * 0.98)
        wh = y1 - y0; gap = 8 * s * 1.5
        wx = MW + gap - x0; wy = (H - wh) / 2 - y0 + H * 0.04
        body = mark(line, dot, -mx * s, -my * s, s) + f'<path transform="translate({wx:.2f} {wy:.2f})" d="{d}" fill="{word}"/>'
        open(f"{OUT}/anowa-horizontal-{name}.svg", "w").write(svg(MW + gap + (x1 - x0), H, body))

        # 4. Stacked lockup — mark centred over the wordmark
        d, (x0, y0, x1, y1) = word_path(110)
        WW, wh = x1 - x0, y1 - y0; s = WW * 0.62 / mw; MW, MH = mw * s, mh * s; gap = MH * 0.45
        body = (mark(line, dot, (WW - MW) / 2 - mx * s, -my * s, s)
                + f'<path transform="translate({-x0:.2f} {MH + gap - y0:.2f})" d="{d}" fill="{word}"/>')
        open(f"{OUT}/anowa-stacked-{name}.svg", "w").write(svg(WW, MH + gap + wh, body))

    # 5. App icon — Deep tile, Sand line, Coral dot (1024, iOS-style radius 22.37%)
    s = 1024 * 0.66 / mw
    body = (f'<rect width="1024" height="1024" rx="229" fill="{DEEP}"/>'
            + mark(SAND, CORAL, 512 - (mx + mw / 2) * s, 512 - (my + mh / 2) * s, s))
    open(f"{OUT}/anowa-app-icon.svg", "w").write(svg(1024, 1024, body))
    # maskable / full-bleed variant (Android adaptive): safe zone = inner 66%
    s2 = 1024 * 0.52 / mw
    body = (f'<rect width="1024" height="1024" fill="{DEEP}"/>'
            + mark(SAND, CORAL, 512 - (mx + mw / 2) * s2, 512 - (my + mh / 2) * s2, s2))
    open(f"{OUT}/anowa-app-icon-maskable.svg", "w").write(svg(1024, 1024, body))

    # 6. Favicon — adapts to the browser's colour scheme
    fav = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{mx} {my - (mw - mh) / 2:.2f} {mw} {mw}">'
           f'<style>.l{{stroke:{INK}}}@media (prefers-color-scheme:dark){{.l{{stroke:{SAND}}}}}</style>'
           f'<path class="l" d="{PULSE}" fill="none" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>'
           f'<circle cx="4.5" cy="34" r="4.5" fill="{CORAL}"/></svg>\n')
    open(f"{OUT}/favicon.svg", "w").write(fav)
    print(sorted(os.listdir(OUT)))


if __name__ == "__main__":
    build()
