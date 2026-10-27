# Comande più leggibili

Il renderer fisico ESC/POS usava Font B, spaziatura aggiuntiva e ogni prodotto in grassetto/doppia grandezza. Le comande ordinarie ora usano Font A, interlinea 36 punti, nessuna spaziatura aggiuntiva e prodotti di grandezza/peso normali. Il tavolo resta evidente. Nomi, quantità, note e modificatori non cambiano. Il payload PIN conserva il contratto precedente.

32 test passati, 1 saltato, typecheck riuscito. I test verificano i byte, non una stampante fisica. Nessuna modifica a code, conferme di consegna, configurazioni salvate o database clienti.

Creare e installare una nuova build Desktop con gli script del repository sul computer che gestisce le stampanti. Il solo deploy della Dashboard o la nuova app mobile non cambia il renderer installato. Non è stato prodotto un installer firmato in questa sessione. Prima dell’uso in servizio verificare larghezza carta, accenti e caratteri effettivi della stampante.
