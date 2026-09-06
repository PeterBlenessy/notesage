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

Inbyggd navigering, bakom en inställning — testa och säg hur den känns.

NYTT
• Hela skalet kan köras i en riktig iOS-navigationsstack: Hem, mappar och dokument, med systemets egen push, bakåtgest och parallax på varje nivå.
• Slå på det på Hem: "…" → Inbyggd navigering. Stäng av på samma sätt.

PROVA
• Med det på: öppna en mapp, sedan ett dokument, och svep in från vänsterkanten — stanna halvvägs och släpp, två gånger.
• Stäng sedan av och gör samma sak, så att du känner skillnaden.
• Allt annat ska bete sig precis som förut, i båda lägena. Det som inte gör det är buggen jag vill veta om.
