param(
  [string]$ApiBase = "http://127.0.0.1:4317",
  [Parameter(Mandatory = $true)]
  [string[]]$SourcePaths
)

$sources = @($SourcePaths | ForEach-Object {
  $name = [IO.Path]::GetFileNameWithoutExtension($_) -replace '^-', '' -replace ' \(\d+\)$', ''
  @{ Path = $_; Name = $name }
})

function Invoke-AirpJson {
  param([string]$Method, [string]$Path, $Body)
  $json = $Body | ConvertTo-Json -Depth 20 -Compress
  Invoke-RestMethod -Method $Method -Uri "$ApiBase$Path" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
}

function Convert-Position([int]$position) {
  switch ($position) {
    0 { 'before_cards' }
    1 { 'after_cards' }
    2 { 'author_note_top' }
    3 { 'author_note_bottom' }
    4 { 'at_depth' }
    default { throw "Unsupported SillyTavern worldbook position: $position" }
  }
}

function Convert-Role($role) {
  $roleValue = if ($null -eq $role) { 0 } else { [int]$role }
  switch ($roleValue) {
    1 { 'user' }
    2 { 'assistant' }
    default { 'system' }
  }
}

function Value-OrDefault($value, $fallback) {
  if ($null -eq $value) { return $fallback }
  return $value
}

$initial = Invoke-RestMethod -Uri "$ApiBase/api/config"
$imported = @()
foreach ($source in $sources) {
  $raw = Get-Content -LiteralPath $source.Path -Raw -Encoding UTF8 | ConvertFrom-Json
  $enabledEntries = @($raw.entries.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { -not $_.disable })
  $book = $initial.worldbooks | Where-Object { $_.name -eq $source.Name } | Select-Object -First 1
  if (-not $book) {
    $created = Invoke-AirpJson POST '/api/config/worldbooks' @{ name = $source.Name; scope = 'global'; enabled = $true; tokenBudgetPercent = 25 }
    $book = $created.worldbooks | Where-Object { $_.name -eq $source.Name } | Select-Object -First 1
  }
  foreach ($entry in $enabledEntries) {
    $current = Invoke-RestMethod -Uri "$ApiBase/api/config"
    $currentBook = $current.worldbooks | Where-Object { $_.id -eq $book.id } | Select-Object -First 1
    $existing = @($currentBook.entries | Where-Object { $_.title -eq [string]$entry.comment -and $_.content -eq [string]$entry.content })
    if ($existing.Count -gt 0) { continue }
    $secondaryLogic = switch ([int](Value-OrDefault $entry.selectiveLogic 0)) { 1 { 'and_all' } 2 { 'not_any' } 3 { 'not_all' } default { 'and_any' } }
    $payload = @{
      bookId = $book.id
      title = [string]$entry.comment
      content = [string]$entry.content
      enabled = $true
      constant = [bool]$entry.constant
      primaryKeys = @($entry.key | ForEach-Object { [string]$_ })
      secondaryKeys = @($entry.keysecondary | ForEach-Object { [string]$_ })
      secondaryLogic = $secondaryLogic
      scanDepth = if ($null -eq $entry.scanDepth) { 2 } else { [Math]::Min(100, [Math]::Max(0, [int]$entry.scanDepth)) }
      recursive = -not ([bool]$entry.excludeRecursion -or [bool]$entry.preventRecursion)
      probability = if ($entry.useProbability -eq $false) { 100 } else { [int]$entry.probability }
      ignoreBudget = [bool]$entry.ignoreBudget
      order = [int]$entry.order
      caseSensitive = [bool](Value-OrDefault $entry.caseSensitive $false)
      wholeWord = [bool](Value-OrDefault $entry.matchWholeWords $false)
      role = Convert-Role $entry.role
      position = Convert-Position ([int]$entry.position)
      injectionDepth = [Math]::Min(100, [Math]::Max(0, [int](Value-OrDefault $entry.depth 0)))
    }
    Invoke-AirpJson POST '/api/config/worldbook-entries' $payload | Out-Null
    $imported += [pscustomobject]@{ book = $source.Name; uid = $entry.uid; title = $entry.comment; position = $payload.position }
  }
}

$final = Invoke-RestMethod -Uri "$ApiBase/api/config"
[pscustomobject]@{
  imported = $imported
  books = @($sources | ForEach-Object {
    $name = $_.Name
    $book = $final.worldbooks | Where-Object name -eq $name | Select-Object -First 1
    [pscustomobject]@{ name = $name; id = $book.id; entries = @($book.entries).Count }
  })
} | ConvertTo-Json -Depth 8
