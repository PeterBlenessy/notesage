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

Svep tillbaka fungerar igen, och du kan välja var ljudet kommer ut.

NYTT
• En knapp i spelaren väljer ljudet: telefon, hörlurar, bil.

FIXAT
• Att svepa in från vänsterkanten för att lämna ett dokument hade slutat fungera.
• Olästa syns även i gallerivyn, inte bara i listan.
• Inspelningsspåret visar en röst som stiger och faller, inte ett massivt block.

PROVA
• Spela upp en artikel, tryck på ljudknappen, flytta till hörlurar och tillbaka.
• Svep in från vänsterkanten i en artikel, och i en sparad webbsida.
