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

Blinkningen är borta, den mystiska pillen går att läsa, miniatyrerna hinner med.

FIXAT
• Att stänga en artikel får inte längre skärmen att blinka innan listan kommer.
• Statusen som blinkade förbi bakom sökpillen ligger nu ovanför den, läsbar.
• Inställningar är svenska rakt igenom, förklaringarna med.
• "1 server", inte "1 servrar".

FÖRBÄTTRAT
• Miniatyrbilder hämtas en skärm i förväg.

PROVA
• Öppna en artikel, gå tillbaka, titta när listan kommer. Blinkar det?
• Skrolla snabbt i en stor mapp, lista och galleri. Hinner bilderna med?
