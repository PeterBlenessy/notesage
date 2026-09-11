<!--
Svensk "What to Test" för nästa TestFlight-bygge. Skickas automatiskt av
`scripts/ios-testflight.sh`. HTML-kommentarer strippas; bara texten skickas.

TestFlight visar ren text: ingen fetstil, ingen Markdown. Radbrytningar och
tecken överlever, så strukturen byggs av dem — och testare läser detta i en
notis, stående, så det är EN SKÄRM, strukturerad, inte en textvägg:

  En rad om vad det här bygget handlar om.

  NYTT
  • En funktion per punkt, med användarens ord, vad den gör för dem.

  FIXAT
  • En rättning per punkt.

  TESTA
  • Vad som ska petas på, som en instruktion: "Öppna…, sedan…".

Rubriker är versaler på egen rad; punkter börjar med "•". Hoppa över en
sektion som är tom. Ungefär 600 tecken ryms på en skärm; skriptet varnar
över det.

Skriv om den för varje släpp. Gammal text är sämre än ingen alls: den skickar
folk att testa sådant som redan är ute.
-->

Bygge 61 gjorde blinkningen värre. Det här tar tillbaka det.

FIXAT
• Att gå tillbaka från en artikel visar inte längre listan med tomma rutor som
fylls i efteråt. Bygge 61 flyttade inläsningen av miniatyrer till ett läge som
kom för sent; det som redan är känt ritas nu direkt.

PROVA
• Öppna en artikel och gå tillbaka, flera gånger, i en mapp med bilder. Listan
ska komma tillbaka precis som du lämnade den — inga tomma rutor, ingen andra
lista ovanpå den första.
• Skrolla snabbt i en stor mapp, lista och galleri, för att se att bilderna
fortfarande hinner med.
