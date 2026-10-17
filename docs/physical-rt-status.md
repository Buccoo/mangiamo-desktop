# Stato dell'emissione fiscale RT dal desktop

L'emissione fiscale RT legacy è disabilitata prima di qualunque richiesta al dispositivo. Nessun marchio è attualmente qualificato per l'emissione fiscale tramite questo trasporto. La rilevazione in rete, una porta aperta e il test non fiscale non attestano la capacità di emettere documenti commerciali.

Il vecchio percorso costruiva un documento dal solo totale con reparto 1 / codice IVA 1, inviava XML Epson per tutti i marchi e poteva registrare un identificativo `RT-...` generato localmente dopo un HTTP 200. Questi comportamenti sono stati rimossi. Il worker restituisce `PHYSICAL_RT_BRAND_UNSUPPORTED` per gli altri marchi e `PHYSICAL_RT_FISCAL_MAPPING_UNVERIFIED` per Epson, con stato di consegna `not_sent`. Nessun campo nel payload abilita questo trasporto.

I record locali `physical` già segnati `sent` dalle vecchie versioni non dimostrano l'emissione fiscale. Al recupero diventano `uncertain`, senza invio né conferma fiscale di successo. Un esito incerto richiede verifica sul dispositivo prima di una ristampa manuale. I journal delle comande, dei PIN e delle ricevute non fiscali conservano il comportamento precedente.

## Requisiti prima di introdurre un adapter RT

Un'eventuale implementazione futura richiede un task esplicito e una qualifica del modello, firmware e protocollo effettivi. Il payload dovrà contenere uno snapshot fiscale validato e immutabile, con righe, quantità, importi, aliquota o natura fiscale e pagamenti coerenti. Serve anche evidenza della corrispondenza fra quei dati e la programmazione dei reparti / IVA di quello specifico dispositivo. Il solo totale non costituisce questo contratto e una dichiarazione `validated` nel payload non costituisce una verifica.

Un adapter dovrà interpretare la risposta strutturata documentata dal produttore, correlata al documento richiesto e contenente prova autorevole di emissione. Un HTTP 200, una stringa trovata con una regex, un identificativo locale, XML malformato, HTML o una risposta priva della prova non valgono come emissione. Timeout ed errori dopo il possibile invio devono conservare l'incertezza e impedire ristampe automatiche. I test su fixture non sostituiscono la prova su hardware e la riconciliazione con il documento realmente emesso.

## Documentazione primaria consultata

L'[elenco ufficiale Epson FP-81II RT](https://support.epson.net/publist/bsmanual.php?lang=IT&model=FP-81II+RT), verificato il 17 ottobre 2026, elenca le guide aggiornate il 25 febbraio 2026:

- FPIB05500, *ePOS Fiscal Print Solution Development Guide*: descrive il Web Service `fpmate.cgi` e la libreria ePOS fiscale per modelli Epson RT specifici.
- FPIB05400, *RT Fiscal Printer VAT / Nature Table and Related Management*: descrive la programmazione della tabella IVA / natura del dispositivo.
- FPIB00800, *Communication Protocol*: descrive comandi, stati, errori e compatibilità firmware del protocollo fiscale nativo Epson.

Queste fonti identificano protocolli e configurazioni da qualificare; non dimostrano la compatibilità del vecchio XML generico né la configurazione di una stampante installata. In questa correzione non sono stati introdotti comandi fiscali nuovi, letti segreti o contattati dispositivi reali.
