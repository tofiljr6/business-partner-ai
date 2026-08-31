# Getting Started

Welcome to your new CAP project.

It contains these folders and files, following our recommended project layout:

File or Folder | Purpose
---------|----------
`app/` | content for UI frontends goes here
`db/` | your domain models and data go here
`srv/` | your service models and code go here
`readme.md` | this getting started guide

## Next Steps

- Open a new terminal and run `cds watch`
- (in VS Code simply choose _**Terminal** > Run Task > cds watch_)
- Start with your domain model, in a CDS file in `db/`

## Learn More

Learn more at <https://cap.cloud.sap>.


---

## LangGraph flow (`ask`)

Przeplyw w Node.js oparty o `@langchain/langgraph` + OpenAI. Kod: srv/lib/graph.js, srv/lib/bpClient.js.

Wezly:
1. extractPartner - LLM wyciaga numer business partnera z zapytania.
2. fetch - wywoluje przetestowany backend (ZMTO_AI_BP_SRV .../Identifications) dla tego numeru.
3. decide - LLM ocenia, czy personal id jest aktualny na dzis (current / outdated / unknown).
4. rozgalezienie:
   - ok    - komunikat: "Partner ... ma aktualny personal id".
   - draft - LLM przygotowuje propozycje e-maila do partnera; requiresConfirmation: true.
   - fail  - komunikat bledu.

Czlowiek zatwierdza wysylke - dopiero wtedy UI wola akcje sendPartnerEmail.

### Uruchomienie

    npm install
    cp .env.example .env    # uzupelnij OPENAI_API_KEY
    cds watch

Test HTTP:

    curl -s http://localhost:4004/odata/v4/business-partner-a-i/ask \
      -H 'Content-Type: application/json' \
      -d '{"query":"czy partner 5 ma wazny personal id?"}'

Test samego grafu (dane z mocka):

    BP_MOCK=true OPENAI_API_KEY=sk-... node scripts/test-graph.js "czy partner 5 ma wazny personal id?"


## Czat UI + podgląd przepływu

Statyczna strona: app/chat/ -> http://localhost:4004/chat/
- czat po lewej, diagram węzłów LangGraph po prawej (podświetla aktualny/gotowy/błędny węzeł na żywo),
- log zdarzeń pod diagramem,
- gdy personal id jest nieaktualny, pojawia się edytowalna karta e-maila z przyciskiem "Potwierdzam - wyślij" (wołaczka sendPartnerEmail dopiero po kliknięciu).

Live progress leci przez SSE: GET /ai/ask-stream?query=... (srv/server.js), streamMode "updates" z LangGraph.


## Deploy na SAP BTP (Cloud Foundry)

Wymagane raz:
- HANA Cloud instance w subaccount (plan `hdi-shared`), uprawnienia do `xsuaa`, `destination`, `connectivity`
- destinacja `SA1_300` skonfigurowana w subaccount (ta sama, ktorej uzywa `getPartner`)
- CLI: `cf`, plugin `multiapps` (`cf install-plugin multiapps`), oraz `mbt` (`npm i -g mbt`)

Kroki:

    # 1. klucz OpenAI jako user-provided service (nie trafia do gita)
    cf cups business-partner-ai-openai -p '{"OPENAI_API_KEY":"sk-...","OPENAI_MODEL":"gpt-4o-mini"}'

    # 2. build + deploy
    mbt build
    cf deploy mta_archives/business-partner-ai_1.0.0.mtar

Po deployu:
- URL aplikacji = route modulu `business-partner-ai-approuter`
- przypisz uzytkownikom role collection `BusinessPartnerAI_User` (BTP cockpit -> Security -> Role Collections)
- podmiana klucza: `cf uups business-partner-ai-openai -p '{"OPENAI_API_KEY":"sk-..."}'` i restart `cf restart business-partner-ai-srv`

Moduly MTA:
- `business-partner-ai-srv`      – serwis CAP + graf LangGraph + endpoint SSE `/ai/ask-stream`
- `business-partner-ai-db-deployer` – deployer HANA HDI (tabela outbox CAP)
- `business-partner-ai-approuter` – serwuje UI z `app/chat/` i pilnuje logowania (xsuaa)

Klucz OpenAI: `OPENAI_API_KEY` z env wygrywa; na BTP kod czyta go z powiazanego serwisu (`VCAP_SERVICES`).
