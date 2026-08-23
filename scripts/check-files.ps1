# Verifies every Facet source file arrived complete. Run from the project root.
$expected = @{
  "package.json"                  = 30
  "vercel.json"                   = 15
  ".gitignore"                    = 8
  ".env.example"                  = 46
  "README.md"                     = 692
  "PAYMENTS_SETUP.md"             = 380
  "api\index.js"                  = 23
  "lib\app.js"                    = 262
  "lib\catalogue.js"              = 71
  "lib\geometry.js"               = 277
  "lib\asset.js"                  = 68
  "lib\glb.js"                    = 212
  "lib\decimate.js"               = 186
  "public\index.html"             = 432
  "agent\demo.js"                 = 125
  "scripts\dev.js"                = 20
  "scripts\ingest.js"             = 168
  "scripts\inspect-glb.js"        = 72
  "scripts\optin.js"              = 94
  "scripts\wallets-status.js"     = 92
  "scripts\generate-wallets.js"   = 49
  "scripts\new-payees.js"         = 27
  "scripts\stub-facilitator.js"   = 11
  "assets\README.md"              = 8
}

$bad = 0
"{0,-30} {1,8} {2,8}  {3}" -f "file","expected","actual","status"
"-" * 62
foreach ($f in $expected.Keys | Sort-Object) {
  if (-not (Test-Path $f)) {
    "{0,-30} {1,8} {2,8}  MISSING" -f $f, $expected[$f], "-"
    $bad++
    continue
  }
  $n = (Get-Content $f).Count
  if ($n -eq $expected[$f]) { $status = "ok" }
  elseif ($n -lt $expected[$f]) { $status = "SHORT" }
  else { $status = "TOO LONG" }
  if ($status -ne "ok") { $bad++ }
  "{0,-30} {1,8} {2,8}  {3}" -f $f, $expected[$f], $n, $status
}
""
if ($bad -eq 0) { "All files complete." } else { "$bad file(s) need re-copying." }
