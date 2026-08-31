const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const { getDestination } = require('@sap-cloud-sdk/connectivity');
const { runGraph } = require('./lib/graph');

module.exports = cds.service.impl(function () {

    this.on('getPartner', async (req) => {
        try {
            const destination = await getDestination({
                destinationName: 'SA1_300'
            });

            console.log('DESTINATION:', {
                name: destination?.name,
                url: destination?.url,
                proxyType: destination?.proxyType,
                authentication: destination?.authentication
            });

            const response = await executeHttpRequest(
                destination,
                {
                    method: 'GET',
                    url: "/sap/opu/odata/sap/ZMTO_AI_BP_SRV/BusinessPartnerSet('0000000005')/Identifications"
                }
            );

            return response.data;

        } catch (err) {
            console.error('CALL FAILED');
            console.error(err);

            req.error(500, err.message);
        }
    });

    // Natural-language endpoint backed by the LangGraph flow.
    this.on('ask', async (req) => {
        const { query } = req.data;
        if (!query || !query.trim()) {
            return req.error(400, 'Podaj treść zapytania w polu "query".');
        }

        try {
            const result = await runGraph(query);
            return {
                partnerId: result.partnerId || null,
                decision: result.decision || 'unknown',
                message: result.message || '',
                emailDraft: result.emailDraft || null,
                requiresConfirmation: !!result.requiresConfirmation
            };
        } catch (err) {
            console.error('ASK FAILED');
            console.error(err);
            return req.error(500, err.message);
        }
    });

    // Only invoked by the UI after a human confirmed the drafted e-mail.
    this.on('sendPartnerEmail', async (req) => {
        const { to, subject, body } = req.data;
        if (!to) return req.error(400, 'Brak adresata (to).');

        // TODO: podłącz realną wysyłkę (BTP Mail / destination SMTP).
        console.log('EMAIL TO SEND (human-confirmed):', { to, subject, body });

        return `E-mail do ${to} zakolejkowany do wysyłki (temat: "${subject}").`;
    });

});
