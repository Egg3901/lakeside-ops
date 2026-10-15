#!/usr/bin/env python3
"""Check capabilities and the embedded extension in the actual built application."""
import plistlib
import sys
from pathlib import Path

app = Path(sys.argv[1])
with (app / 'Info.plist').open('rb') as file:
    info = plistlib.load(file)
assert info.get('NSSupportsLiveActivities') is True, 'Live Activities capability missing'
assert any('lakesideops' in row.get('CFBundleURLSchemes', []) for row in info.get('CFBundleURLTypes', [])), 'Widget URL scheme missing'
extensions = list((app / 'PlugIns').glob('*.appex'))
assert len(extensions) == 1, 'Keir widget extension missing'
with (extensions[0] / 'Info.plist').open('rb') as file:
    widget = plistlib.load(file)
assert widget['NSExtension']['NSExtensionPointIdentifier'] == 'com.apple.widgetkit-extension'
assert widget['CFBundleIdentifier'] == info['CFBundleIdentifier'] + '.widgets'
for key in ['CFBundleVersion', 'CFBundleShortVersionString']:
    assert widget[key] == info[key], 'App and widget versions differ: ' + key
print('Verified native capabilities, deep links, widget embedding and matching versions.')
