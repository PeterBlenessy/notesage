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

Sökningen i en mapp söker på riktigt nu.

RÄTTAT
• Sökning i en mapp matchar det du SER på raden — en sparad artikels titel,
dess sajt och dess sammanfattning — inte bara filnamnet. Att skriva ett ord ur
en artikels titel dolde förut allt, eftersom filen bakom den är döpt efter ett
datum.
• Sökningen struntar också i accenter, så "andring" hittar "Ändringsdatum".

PROVA
• Öppna en mapp med sparade artiklar, sök ett ord ur en titel du ser på
skärmen, sedan ett ord ur sajten under. Båda ska hitta den.
