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

Alla mappar beter sig som en riktig skärm nu.

RÄTTAT
• Alla mappar struntade i vymenyn och långtryck gjorde ingenting. Den delade
identitet med Hem, så appen trodde att du fortfarande var på Hem och lade dina
val där. Sökningen var död av samma skäl.
• Kompakt erbjuds på Hem igen, och i vilken mapplista som helst — den ändrar
faktiskt utseendet.
• Mappikonerna är inte längre prickar: de skalar med raden eller kortet.

PROVA
• Alla mappar: växla lista/galleri/kompakt och sök. Hem ska behålla sin egen
vy separat.
• Håll in en mapp där och välj Visa på Hem.
