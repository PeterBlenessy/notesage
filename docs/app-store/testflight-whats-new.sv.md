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

Lässtatus dyker upp av sig själv nu, och dina mappar behåller sina färger.

NYTT
• Mappar på översta nivån bär ikonen och färgen du gav dem på datorn, både i
listor och på gallerikorten.

RÄTTAT
• Stapeln under en artikel syntes tidigare först efter en omstart av appen.
När du stänger läsaren sparas din plats direkt, så raden uppdateras medan du
tittar.
• Lässtatus läses per mapp, så en artikel du flyttat ut ur Inkorgen behåller
sin stapel i stället för att tappa den.
• Att byta namn på eller ta bort en fil lämnar inte längre kvar den gamla
raden ett ögonblick.
• Att bläddra i en stor mapp hackar inte längre första gången.

PROVA
• Öppna en artikel, läs en bit, gå direkt tillbaka. Stapeln ska redan vara
där.
• Ge en mapp ikon och färg på datorn, dra sedan neråt för att uppdatera här.
