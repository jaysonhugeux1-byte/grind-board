# Convertit un PNG en pixels bruts lisibles par Node, sans dependance.
#
# Node ne sait pas decoder un PNG sans bibliotheque, et en ajouter une pour un
# outil de calibrage serait disproportionne. Windows sait le faire nativement :
# on passe donc par System.Drawing, et on ecrit un fichier trivial a relire —
# huit octets d'entete (largeur et hauteur en entiers 32 bits) suivis des pixels
# en RGBA.
#
# Usage : powershell -File png-vers-brut.ps1 -Source x.png -Destination x.bin

param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)

Add-Type -AssemblyName System.Drawing

$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source))
$l = $bmp.Width
$h = $bmp.Height

# LockBits plutot que GetPixel : sur une image de plusieurs millions de pixels,
# l'appel par pixel prendrait des minutes la ou la lecture directe prend un
# instant.
$rect = New-Object System.Drawing.Rectangle 0, 0, $l, $h
$donnees = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                         [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

$octets = New-Object byte[] ($donnees.Stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($donnees.Scan0, $octets, 0, $octets.Length)
$bmp.UnlockBits($donnees)
$bmp.Dispose()

$flux = [System.IO.File]::Create($Destination)
$flux.Write([BitConverter]::GetBytes([int]$l), 0, 4)
$flux.Write([BitConverter]::GetBytes([int]$h), 0, 4)

# Format32bppArgb est range en BGRA en memoire. On ecrit tel quel : la carte
# d'encre mesure un ecart a la couleur dominante, une distance euclidienne
# insensible a l'ordre des canaux. Inutile de payer une conversion.
for ($y = 0; $y -lt $h; $y++) {
  $flux.Write($octets, $y * $donnees.Stride, $l * 4)
}
$flux.Close()

"$l x $h -> $Destination"
