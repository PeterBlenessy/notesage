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

Båda svepen fungerar igen — det var mitt fel, två gånger om.

FIXAT
• Svep in från vänsterkanten för att lämna ett dokument.
• Svep vänster på en rad i listan för att visa dess åtgärder.
• Inspelningsspåret ser ut som uppspelningsspåret: prickar när det är tyst, streck när du talar.

PROVA
• Svep en rad i Inbox, svep sedan in från vänsterkanten i en artikel.
• Spela in några sekunder, spela upp, och jämför de två spåren.
