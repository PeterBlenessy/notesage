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
Två rättningar på licensskärmen, och en på var den dyker upp.

RÄTTAT
• Tack till erbjöds från varje mapp, inte bara Hem. Öppnade du den inifrån en
mapp och tryckte Bakåt hamnade du högst upp i biblioteket.
• 102 paket visade ingen licenstext alls. De visar nu standardtexten för sin
licens, märkt som standard. 65 till går inte att rätta och säger nu det rakt ut
i stället för att visa ingenting.

PROVA
• Öppna vilken mapp som helst, sedan "…". Tack till ska INTE finnas där — bara på Hem.
• Hem → "…" → Tack till → Apache 2.0, sedan ett paket. Texten ska finnas där,
med en rad som säger var den kommer ifrån.
