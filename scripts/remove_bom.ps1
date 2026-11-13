$files = Get-ChildItem -Path "frontend" -Recurse -Include *.js,*.css,*.html
foreach ($file in $files) {
    if ($file.Length -ge 3) {
        $bytes = Get-Content -Encoding Byte -Path $file.FullName -TotalCount 3
        if ($bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
            Write-Host "Removing BOM from $($file.FullName)"
            $content = [System.IO.File]::ReadAllText($file.FullName)
            $utf8NoBom = New-Object System.Text.UTF8Encoding($False)
            [System.IO.File]::WriteAllText($file.FullName, $content, $utf8NoBom)
        }
    }
}
Write-Host "BOM check complete."
