const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const { getDestination } = require('@sap-cloud-sdk/connectivity');

const DESTINATION_NAME = process.env.BP_DESTINATION || 'SA1_300';

/** Normalize "5" / 5 / "0000000005" -> "0000000005" (SAP BP keys are 10 chars). */
function normalizePartnerId(partnerId) {
    return String(partnerId).trim().padStart(10, '0');
}

/**
 * Fetch the Identifications of a Business Partner from the backend OData service.
 * Same call that was already tested in getPartner(), just parametrized by id.
 * Set BP_MOCK=true to work offline without a destination.
 */
async function fetchIdentifications(partnerId) {
    const id = normalizePartnerId(partnerId);

    if (process.env.BP_MOCK === 'true') {
        return mockIdentifications(id);
    }

    const destination = await getDestination({ destinationName: DESTINATION_NAME });

    const response = await executeHttpRequest(destination, {
        method: 'GET',
        url: `/sap/opu/odata/sap/ZMTO_AI_BP_SRV/BusinessPartnerSet('${id}')/Identifications`,
        params: { '$format': 'json' }
    });

    const data = response.data;
    // OData v2 -> { d: { results: [...] } }, OData v4 -> { value: [...] }
    return data?.d?.results ?? data?.value ?? data;
}

function mockIdentifications(id) {
    return [
        {
            BusinessPartner: id,
            Type: 'HCM001',            // personnel / personal id
            IdNumber: '99887766',
            ValidityStartDate: '2019-01-01',
            ValidityEndDate: '2023-12-31' // expired on purpose -> triggers e-mail draft
        },
        {
            BusinessPartner: id,
            Type: 'BUP001',
            IdNumber: 'PL1234567',
            ValidityStartDate: '2020-01-01',
            ValidityEndDate: '9999-12-31'
        }
    ];
}

module.exports = { fetchIdentifications, normalizePartnerId };
