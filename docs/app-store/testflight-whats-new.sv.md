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

Hems meny och långtryck fungerar nu.

RÄTTAT
• Lista, galleri och kompakt får nu effekt på Hem. Menyn fanns där och gjorde
ingenting. Sökningen på Hem var död på samma sätt.
• Att hålla in en mapp under Alla mappar öppnar menyn igen, så du kan välja
Visa på Hem. Det är precis vad tipset på Hem säger åt dig att göra, och det var
det enda du inte kunde göra.
• Inbox och Recordings har fått tillbaka sitt mellanrum i stället för att läsas
som ett block.

PROVA
• På Hem: växla lista/galleri/kompakt och sök sedan. De två korten och Alla
mappar förblir rader vad du än väljer.
• Alla mappar, håll in en mapp, Visa på Hem — den ska dyka upp på Hem direkt.
