# LOKA launcher icon

The approved source is `Loka controller bubble app icon.png`. Keep it unchanged.

Run `python3 UX/appIcon/generate_icons.py` from the repository root with Pillow installed to regenerate:

- iOS/iPadOS: opaque 1024×1024 PNG in `ios/Design.xcassets/AppIcon.appiconset`; Xcode produces device sizes.
- Android: legacy launcher sizes for five densities, adaptive foreground/background, and an Android 13+ monochrome layer for themed icons. Essential artwork fits inside the adaptive icon safe circle.
- Store/review exports: 512×512 Google Play artwork and a mask preview under `exports/`; these are not bundled in the apps.

The Android notification small icon remains a separate resource.

References: [Apple app icon configuration](https://developer.apple.com/documentation/xcode/configuring-your-app-icon) and [Android adaptive icons](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive).
