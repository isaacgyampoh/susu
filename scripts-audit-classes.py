import re, glob

CUSTOM = re.compile(r'^(panel|well|card|card-stock|input|label|rule|rule-hd|tnum|sheet|sheet-flat|display|stencil|stencil-sm|seg|seg-item|seg-item-on|chip|chip-[a-z]+|pill-[a-z]+|tag|tag-[a-z]+|field-in|field-lbl|badge-[a-z]+|btn|btn-[a-z]+|act|act-[a-z]+|in|in-lbl|in-area|t-[a-z0-9]+|st|st-[a-z]+|box|box-[a-z]+)$')

used = set()
for f in glob.glob('app/**/*.tsx', recursive=True) + glob.glob('components/**/*.tsx', recursive=True):
    s = open(f).read()
    for m in re.finditer(r'className=(?:"([^"]*)"|\{`([^`]*)`\})', s):
        for tok in re.split(r'\s+', (m.group(1) or m.group(2) or '')):
            tok = tok.strip().split(':')[-1].strip("'\"}{")
            if CUSTOM.match(tok): used.add(tok)

css = open('app/globals.css').read()
defined = set()
for m in re.finditer(r'^\s*((?:\.[a-zA-Z0-9_-]+\s*,\s*)*\.[a-zA-Z0-9_-]+)\s*\{', css, re.M):
    for sel in m.group(1).split(','):
        defined.add(sel.strip().lstrip('.'))

missing = sorted(used - defined)
unused  = sorted(d for d in defined if CUSTOM.match(d) and d not in used)
print(f"custom classes used: {len(used)} | defined: {len(defined)}")
print("ORPHANED (used, not defined):", missing or "none")
print("DEAD (defined, never used):", unused or "none")
