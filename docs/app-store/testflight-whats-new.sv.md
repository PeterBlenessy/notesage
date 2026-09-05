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
Uppläsningen följer med i anteckningar också, och Macens "markera som oläst" når telefonen.

NYTT
• Uppläsningen markerar stycke och ord i markdown- och textanteckningar, inte bara i sparade sidor.

FIXAT
• Ett Inbox-objekt som markeras som oläst på Macen syns nu på telefonen.
• Exporterade rapporter och vanliga sidor behåller den lilla rutan i en kompakt lista.

TESTA
• Läs upp en markdown-anteckning och se stycke- och ordmarkeringen.
• Markera ett Inbox-objekt som oläst på Macen och öppna sedan Inbox här.
