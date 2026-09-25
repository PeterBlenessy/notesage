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
Två saker du ska sluta se vid kallstart.

RÄTTAT
• Mappikonerna på Hem målades om till släta grå mappar ett ögonblick efter
starten och hoppade sedan tillbaka. De blir inte längre tomma medan appen
läser om dem.
• "Sparar för offline" gick igenom varje objekt i din Inbox vid varje start,
även när alla redan var sparade. Den visas nu bara när det faktiskt finns
något att hämta.

PROVA
• Tvinga fram avslut, öppna igen och titta på ikonraden på Hem. Inget ska bli tomt.
• Öppna igen utan att dela något nytt. Ingen "Sparar för offline" alls.
• Dela en länk och öppna sedan igen: den ska dyka upp, räkna bara den nya, och
miniatyren ska fyllas i.
