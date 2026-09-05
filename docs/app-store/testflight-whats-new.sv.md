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

Allt du hittade i telefonen är fixat — och en inspelning syns nu på låsskärmen.

FIXAT
• Stopp göms inte längre bakom sökrutan.
• Fel visas i stället för att hamna under verktygsraden.
• Olästa i Inbox är de fetare; öppnade tonas ner.
• Ikonsiffran rör sig igen i ett synkat bibliotek.
• Startlogotypen är skarp när den växer.

TESTA
• Spela in, lås telefonen, pausa och återuppta från låsskärmen, lås upp och stoppa.
• Läs något i Inbox och se ikonsiffran minska.
