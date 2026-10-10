"""Export the approved artwork for native launcher icons (requires Pillow)."""
from pathlib import Path
import json
import math
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).with_name('Loka controller bubble app icon.png')
image = Image.open(SOURCE).convert('RGB')
assert image.width == image.height
res = ROOT / 'android/loka-mesh-lab/app/src/main/res'
asset = ROOT / 'ios/Design.xcassets/AppIcon.appiconset'
asset.mkdir(parents=True, exist_ok=True)
image.resize((1024, 1024), Image.Resampling.LANCZOS).save(asset / 'AppIcon.png', optimize=True)
(asset / 'Contents.json').write_text(json.dumps({
    'images': [{'filename': 'AppIcon.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}],
    'info': {'author': 'xcode', 'version': 1}
}, indent=2) + '\n')

# Fit every bright logo pixel within Android's centered 66-dp safe circle.
# Padding preserves the flattened source artwork and its purple background.
center = (image.width - 1) / 2
radius = max(math.hypot(x - center, y - center)
             for y in range(image.height) for x in range(image.width)
             if max(image.getpixel((x, y))) > 150)
canvas_size = 432
inner_size = min(432, int(image.width * (canvas_size * 33 / 108 - 3) / radius))
background = image.getpixel((0, 0))
foreground = Image.new('RGB', (canvas_size, canvas_size), background)
foreground.paste(image.resize((inner_size, inner_size), Image.Resampling.LANCZOS),
                 ((canvas_size - inner_size) // 2, (canvas_size - inner_size) // 2))
mono = Image.new('RGBA', foreground.size, (255, 255, 255, 0))
mono.putalpha(foreground.convert('L').point(lambda level: max(0, min(255, (level - 70) * 8))))
for density, scale in [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]:
    folder = res / f'mipmap-{density}'
    folder.mkdir(parents=True, exist_ok=True)
    size = round(48 * scale)
    image.resize((size, size), Image.Resampling.LANCZOS).save(folder / 'ic_launcher.png', optimize=True)
    size = round(108 * scale)
    foreground.resize((size, size), Image.Resampling.LANCZOS).save(folder / 'ic_launcher_foreground.png', optimize=True)
    mono.resize((size, size), Image.Resampling.LANCZOS).save(folder / 'ic_launcher_monochrome.png', optimize=True)
xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/loka_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
{monochrome}</adaptive-icon>
'''
for qualifier, monochrome in [('v26', ''), ('v33', '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n')]:
    folder = res / f'mipmap-anydpi-{qualifier}'
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'ic_launcher.xml').write_text(xml.format(monochrome=monochrome))
(res / 'values').mkdir(exist_ok=True)
(res / 'values/loka_launcher_colors.xml').write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="loka_launcher_background">#%02X%02X%02X</color></resources>\n' % background)
export = SOURCE.parent / 'exports'
export.mkdir(exist_ok=True)
image.resize((512, 512), Image.Resampling.LANCZOS).save(export / 'google-play-icon-512.png', optimize=True)

# Review only: show the viewport after the launcher mask, at realistic icon sizes.
viewport = foreground.crop((72, 72, 360, 360)).resize((144, 144), Image.Resampling.LANCZOS)
preview = Image.new('RGB', (600, 230), '#eee9f4')
draw = ImageDraw.Draw(preview)
for i, name in enumerate(['iOS', 'Android circle', 'Android rounded', 'Android themed']):
    mask = Image.new('L', (120, 120), 0)
    pen = ImageDraw.Draw(mask)
    if name == 'Android circle': pen.ellipse((0, 0, 119, 119), fill=255)
    else: pen.rounded_rectangle((0, 0, 119, 119), radius=27, fill=255)
    icon = image.resize((120, 120), Image.Resampling.LANCZOS) if i == 0 else viewport.resize((120, 120), Image.Resampling.LANCZOS)
    if i == 3:
        icon = Image.new('RGB', (120, 120), '#ddcff1')
        alpha = mono.crop((72, 72, 360, 360)).resize((120, 120), Image.Resampling.LANCZOS).getchannel('A')
        icon.paste(Image.new('RGB', (120, 120), '#452365'), (0, 0), alpha)
    preview.paste(icon, (15 + 150*i, 25), mask)
    draw.text((15 + 150*i, 165), name, fill='#281538')
preview.save(export / 'icon-mask-preview.png')
print(f'Exported iOS 1024px and Android density/adaptive icons; artwork canvas {inner_size}/432px.')
