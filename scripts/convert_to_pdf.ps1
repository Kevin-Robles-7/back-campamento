$wordFolder = "C:\Users\Duvan Felipe Robles\Desktop\Proyectos\Campamento\campamento\consentimientos\WORD"
$pdfFolder = "C:\Users\Duvan Felipe Robles\Desktop\Proyectos\Campamento\campamento\consentimientos\PDF"
if (-not (Test-Path $pdfFolder)) { New-Item -ItemType Directory -Path $pdfFolder | Out-Null }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

$files = Get-ChildItem -Path $wordFolder -Filter "*.docx"
Write-Host "Files found: $($files.Count)"
foreach ($f in $files) {
    $pdfPath = Join-Path $pdfFolder ($f.BaseName + ".pdf")
    try {
        $doc = $word.Documents.Open($f.FullName)
        $doc.SaveAs2($pdfPath, 17)
        $doc.Close()
        Write-Host "OK: $($f.Name)"
    } catch {
        Write-Host "ERROR: $($f.Name) -> $($_.Exception.Message)"
    }
}

$word.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
Write-Host "Done"