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

Inbyggd navigering är nu hur appen navigerar — ingen inställning, inget att slå på.

NYTT
• Hem, mappar och dokument ligger i en riktig iOS-navigationsstack: systemets egen bakåtgest, med listan som rör sig bakom artikeln när du sveper bort den.
• Skärmen är högre. Listan reserverade plats för en titelrad som navigationsfältet redan ger, vilket kostade den en rad överallt.

FIXAT
• Uppläsningsspelaren syntes inte när man startade lyssning inuti ett dokument.
• Avsnittsrubriker ("Senaste", "Alla anteckningar") fastnade under titelfältet i stället för under det vid rullning.

PROVA
• Öppna en mapp, sedan ett dokument, och svep in från vänsterkanten — stanna halvvägs och släpp, två gånger.
• Starta Lyssna inifrån en artikel och kolla att spelaren finns där.
• Rulla en lång lista och se var avsnittsrubriken parkerar.
