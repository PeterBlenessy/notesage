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

Hem ritas nu av appen, och vyväxlingen kraschar inte längre.

RÄTTAT
• Att växla mellan lista och galleri kraschade appen i bygge 69. Mitt fel —
det är rättat och kraschen täcks nu av ett test.

NYTT
• Hem ritas av appen själv i stället för av webblagret: korten Inbox och
Recordings, dina valda mappar och Alla mappar. Det ska se likadant ut och
kännas snabbare.

PROVA
• Växla mellan lista och galleri några gånger, åt båda hållen, i en mapp och
på Hem.
• På Hem: öppna båda korten, tryck på Alla mappar och håll in en mapp där för
att välja Visa på Hem — den ska dyka upp på Hem direkt.
