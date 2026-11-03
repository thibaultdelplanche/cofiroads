# RijExamen Gent

Oefentool voor het praktisch rijexamen: rij vanuit de bestuurdersstoel door de echte straten van Gent. Je vertrekt in de Overpoortstraat en rijdt langs het Sint-Pietersplein en de Sint-Pietersnieuwstraat tot aan de Vooruit.

**Live:** https://thibaultdelplanche.github.io/cofiroads/

## Wat zit erin
- Echte gebouwen (vorm, ligging en waar bekend hoogte), straten, bomen, straatlantaarns en zebrapaden uit OpenStreetMap
- Luchtfoto's van Digitaal Vlaanderen als wegdek: zebrapaden, lijnen en fietspaden liggen waar ze echt liggen
- Drie spiegels, dashboard met tellers, geluid (motor, banden, knipperlicht, sirene, toeter)
- Gsm als stuur: scan de QR-code, houd je gsm horizontaal en draai hem als een stuur
- Beoordeling zoals op het examen: snelheid, richtingaanwijzer, dodehoekcontrole, voorrang aan voetgangers, prioritaire voertuigen, autovrij gebied, eenrichtingsverkeer, botsingen

## Kaartdata bijwerken
De map `data/` wordt gevuld door de GitHub-taak **Kaartdata ophalen** (`tools/fetch_data.py`). Starten kan via het tabblad *Actions* → *Kaartdata ophalen* → *Run workflow*.

Oefentool, vervangt geen rijlessen. Kaartdata © OpenStreetMap-bijdragers (ODbL), luchtfoto's © Digitaal Vlaanderen.
