$r = (Invoke-WebRequest -Uri 'https://kurortnik-kurortnik.amvera.io/index.html' -UseBasicParsing).Content
Write-Host "HAS navHome: $($r -match 'navHome')"
Write-Host "HAS orgNameGroup: $($r -match 'orgNameGroup')"  
Write-Host "HAS v=10.0: $($r -match 'v=10.0')"
Write-Host "Length: $($r.Length)"
