<!--
Svensk "What to Test" för nästa TestFlight-bygge. Skickas automatiskt av
`scripts/ios-testflight.sh`. HTML-kommentarer strippas; bara texten skickas.

Håll det till EN SKÄRM på en telefon — omkring 50 ord. Testare läser det här
i en notis, stående. Det som hamnar under vikningen läses inte, så en lång
text är inte grundligare — den hoppas bara över.

Skriv om den för varje släpp. Gammal text är sämre än ingen alls: den skickar
folk att testa sådant som redan är ute.
-->
Rättar fel röst med Lee: appen frågade bara iOS efter standardrösten för dina egna regioner (en-SE, en-US) och en-GB, så ett australiskt val syntes inte och den föll tillbaka på den första australiska premiumrösten i bokstavsordning — Karen. Nu frågar den alla installerade regioner. Spela en artikel; den ska läsas av Lee. Om inte, säg till — loggfångsten kör.

Också från kodgranskningen: att byta röst under paus startar inte längre uppspelningen; Röst… visas först när artikelns språk är känt; och positionsetiketten kan inte längre kollapsa till "…".
