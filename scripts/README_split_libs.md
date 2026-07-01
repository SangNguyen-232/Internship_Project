This script helps split the `lib/` folder into two folders:

- `lib_used/` - libraries currently used by the project (safe to keep in-tree)
- `lib_unused/` - libraries not referenced by `src/` and safe to move out of tree for size savings

What it does
1. Creates `lib_used/` and `lib_unused/` in project root.
2. Moves these folders (if present):
   - to `lib_used/`: `ArduinoJson`, `DHT20`, `LCD`, `ElegantOTA-master`
   - to `lib_unused/`: `ArduinoHttpClient`, `PubSubClient`, `ThingsBoard`, `README`

How to run
1. Open PowerShell in the project root `c:\Users\Admin\Downloads\Test`.
2. Execute:

   .\scripts\split_libs.ps1

3. Run a build to verify:

   platformio run

Undo
- Move directories back from `lib_used/` or `lib_unused/` into `lib/`.
- Or restore via git if you committed before running the script.

Notes
- The lists in the script are conservative and based on references found in `src/`.
- If you want different grouping, edit `scripts/split_libs.ps1` and adjust the arrays `used` and `unused`.
