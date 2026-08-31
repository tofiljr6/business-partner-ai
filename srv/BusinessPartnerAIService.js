const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const { getDestination } = require('@sap-cloud-sdk/connectivity');

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

});