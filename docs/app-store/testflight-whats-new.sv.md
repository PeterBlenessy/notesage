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

Inbox finns där från första starten, och artiklar stängs med ett svep.

FIXAT
• Inbox finns på Hem direkt efter en ren installation, innan något delats dit — och den går att öppna.
• Svep in från vänsterkanten för att lämna en sparad artikel. Det fungerade i anteckningar, aldrig i artiklar.
• "Försök igen" på en mapp appen äger skapar nu mappen.

NYTT
• Lyssna på en anteckning, inte bara en sparad artikel.

PROVA
• Öppna Inbox från Hem, och sedan från menyn längst upp.
• Svep in från vänsterkanten i en sparad artikel, och sedan i en anteckning.
