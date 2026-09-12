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

Fastnålat och lästa-läget fungerar igen.

RÄTTAT
• Gruppera efter fastnålat visar nu dina fastnålade artiklar och mappar. Förut
hittade den ingenting, i ett bibliotek fullt av nålar, eftersom listan läste
den delade nålfilen med fel namn på listan inuti.
• Lästa-läget syns igen: stapeln under en påbörjad artikel, och "Läst" på en du
läst klart. Samma orsak — filen lästes på fel sätt, och ett tomt resultat ser
precis ut som "du har inte läst något".

PROVA
• Nåla fast en artikel eller en mapp på Macen, öppna sedan den mappen på
telefonen och välj Gruppera efter fastnålat i …-menyn. Den ska ligga under
FASTNÅLADE.
• Läs halva en artikel på endera enheten, gå tillbaka till listan och leta
efter stapeln under den.
