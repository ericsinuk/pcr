#!/usr/bin/env python3
"""Build pcr-all.html — single sendable file with airfields.js + app.js inlined."""
import os

src = open("index.html").read()
app = open("app.js").read()
afs = open("airfields.js").read()

src = src.replace('  <link rel="manifest" href="manifest.webmanifest" />\n', '')
src = src.replace('  <link rel="icon" type="image/png" href="icon-192.png" />\n', '')
src = src.replace('  <link rel="apple-touch-icon" href="apple-touch-icon.png" />\n', '')
app = app.replace('''// PWA service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}''', '// (standalone build — no service worker)')

src = src.replace('<br>\n      <a class="xlsx-dl" href="PCN_PCR_Settings.xlsx" download>Download settings workbook (Excel)</a>', '')
out = src.replace('  <script src="airfields.js"></script>\n  <script src="app.js"></script>',
                  '  <script>\n' + afs + '\n' + app + '\n  </script>')
assert '<script src=' not in out and 'serviceWorker' not in out
open("pcr-all.html", "w").write(out)
print("pcr-all.html rebuilt,", round(os.path.getsize("pcr-all.html")/1024, 1), "KB")
