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

Två rättningar för inspelning. En fråga till dig.

FIXAT
• En inspelning som inte startar avslutar inte längre artikeln som läses upp.
Verifierat: framtvingade ett fel, uppläsningen fortsatte och behöll sin plats.
• Nivåkurvan tränger inte undan tiden och knapparna på en smal skärm.

PROVA
• Spela in en minut och titta på kurvan. Ska staplarna glida åt sidan, eller
stå still och ändra höjd? Båda går att försvara; säg vilken som läses bäst.
• Använd den annars som vanligt — något som skiljer sig från bygge 59 är en
regression värd att rapportera.
