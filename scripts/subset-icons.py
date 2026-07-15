"""Rebuild the Material Symbols subset from the icons the app actually uses.

Run after adding or removing an <Icon name="..."> anywhere in src/:

    npm run icons:subset

Requires: pip install fonttools brotli

Why this exists: the full Material Symbols face is 3.9MB of ~6,500 glyphs, and
the PWA precaches every byte, so it dominated the first load. The app uses ~40
icons.

Why it prunes ligatures before subsetting: the icon names are ligatures spelled
out of latin letters, and pyftsubset's glyph closure walks GSUB. Keep the
letters and the closure drags in every icon whose name shares them (i.e. nearly
all of them — subsetting by --text or --glyphs alone barely dented the file).
Drop the letters and the ligatures stop resolving, so <Icon name="map"> renders
nothing. So we cut the ligature rules down to the app's icons first; the
closure then has nowhere else to go.
"""
import re
import subprocess
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SRC_FONT = ROOT / 'scripts' / 'fonts-src' / 'material-symbols-full.woff2'
OUT_FONT = ROOT / 'public' / 'assets' / 'fonts' / 'material-symbols-subset.woff2'
PRUNED = ROOT / 'scripts' / '.tmp' / 'material-symbols-pruned.ttf'

# Icon names reach the font as the element's text, but they are written too many
# ways to pattern-match reliably: on <Icon name>, forwarded through a wrapper's
# `icon` prop, held as data (TABS, MISSION_TYPE_META), or picked inline by a
# ternary. Chasing each shape with a regex kept missing icons, and a missed icon
# renders its name as literal text. So collect every plausible string literal and
# let the font decide which are real icons — a non-icon simply has no ligature.
# The cost of a false positive is one unused glyph; the cost of a miss is a bug.
CANDIDATE_RE = re.compile(r"""['"]([a-z][a-z0-9_]{1,40})['"]""")

# Explicit icon props are the ones a typo would silently break, so they get checked.
EXPLICIT_RES = [
    re.compile(r'\bname="([a-z0-9_]+)"'),
    re.compile(r'\bicon="([a-z0-9_]+)"'),
    re.compile(r"""\bicon:\s*['"]([a-z0-9_]+)['"]"""),
]


def collect_candidates() -> tuple[set[str], set[str]]:
    candidates: set[str] = set()
    explicit: set[str] = set()
    for pattern in ('*.tsx', '*.ts'):
        for path in (ROOT / 'src').rglob(pattern):
            text = path.read_text(encoding='utf-8')
            candidates.update(CANDIDATE_RE.findall(text))
            for rx in EXPLICIT_RES:
                explicit.update(rx.findall(text))
    return candidates, explicit


def prune_ligatures(candidates: set[str]) -> list[str]:
    """Cut the ligature table down to the candidates the font recognises.

    Returns the icon names that resolved, and writes the pruned font to PRUNED.
    """
    font = TTFont(SRC_FONT)
    char_to_glyph = {chr(cp): gn for cp, gn in font.getBestCmap().items()}

    seq_to_name = {}
    for name in candidates:
        if all(c in char_to_glyph for c in name):
            seq_to_name[tuple(char_to_glyph[c] for c in name)] = name

    resolved = []
    for lookup in font['GSUB'].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            # LookupType 7 wraps the real subtable in an Extension record
            if type(sub).__name__ == 'ExtensionSubst':
                sub = sub.ExtSubTable
            if not hasattr(sub, 'ligatures'):
                continue
            new_ligs = {}
            for first_glyph, ligs in sub.ligatures.items():
                keep = []
                for lig in ligs:
                    name = seq_to_name.get((first_glyph,) + tuple(lig.Component))
                    if name:
                        keep.append(lig)
                        resolved.append(name)
                if keep:
                    new_ligs[first_glyph] = keep
            sub.ligatures = new_ligs

    PRUNED.parent.mkdir(parents=True, exist_ok=True)
    font.save(PRUNED)
    return sorted(set(resolved))


def main() -> int:
    if not SRC_FONT.exists():
        print(f'missing source font: {SRC_FONT}', file=sys.stderr)
        return 1

    candidates, explicit = collect_candidates()
    icons = prune_ligatures(candidates)
    if not icons:
        print('resolved no icons — refusing to build an empty font', file=sys.stderr)
        return 1

    # An explicit icon prop that the font does not know is a typo: it would ship
    # as literal text on screen. Fail rather than let it through unnoticed.
    missing = sorted(explicit - set(icons))
    if missing:
        print('ERROR: not an icon in this font (typo?): ' + ', '.join(missing), file=sys.stderr)
        return 1

    subprocess.run(
        [sys.executable, '-m', 'fontTools.subset', str(PRUNED),
         '--text=' + ' '.join(icons),
         '--layout-features+=liga,dlig,calt,rlig,rclt',
         '--flavor=woff2',
         '--output-file=' + str(OUT_FONT)],
        check=True,
    )
    PRUNED.unlink(missing_ok=True)

    before, after = SRC_FONT.stat().st_size, OUT_FONT.stat().st_size
    print(f'{len(icons)} icons: {before / 1048576:.1f}MB -> {after / 1024:.0f}KB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
