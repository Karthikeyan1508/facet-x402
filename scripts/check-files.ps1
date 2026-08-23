# Verifies every Facet source file arrived complete. Run from the project root.
$expected = @{
  "lib\geometry.js"              = 277
  "lib\app.js"                   = 249
  "lib\catalogue.js"             = 67
  "api\index.js"                 = 23
  "public\index.html"            = 424
  "agent\demo.js"                = 125
  "scripts\dev.js"               = 20
  "scripts\optin.js"             = 94
  "scripts\wallets-status.js"    = 92
  "scripts\generate-wallets.js"  = 49
  "scripts\new-payees.js"        = 27
  "scripts\stub-facilitator.js"  = 11
  "package.json"                 = 28
  "vercel.json"                  = 11
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
  $ok = ($n -eq $expected[$f])
  if (-not $ok) { $bad++ }
  "{0,-30} {1,8} {2,8}  {3}" -f $f, $expected[$f], $n, $(if ($ok) { "ok" } else { "TRUNCATED" })
}
""
if ($bad -eq 0) { "All files complete." } else { "$bad file(s) need re-copying." }