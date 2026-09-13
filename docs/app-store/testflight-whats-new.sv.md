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

Menyval som inte gjorde något gör nu det de säger.

RÄTTAT
• Att radera en mapp gjorde ingenting alls — ingen mapp försvann, inget
felmeddelande. Nu fungerar det, och det som ligger i mappen följer med, precis
som bekräftelsen säger.
• Allt som misslyckades på en mappskärm misslyckades tyst. Nu syns felen, och
en flytt som gått igenom säger vart filen tog vägen.
• Redigera Hem öppnade en tom skärm.
• Lyssna saknades i långtrycksmenyn för en anteckning, trots att raden själv
erbjöd det.

PROVA
• Håll in en mapp, välj Radera, bekräfta. Den ska försvinna.
• Menyn … → Redigera Hem: listan med mappar ska finnas där.
• Håll in en anteckning: Lyssna ska finnas i menyn, och ska spela upp.
