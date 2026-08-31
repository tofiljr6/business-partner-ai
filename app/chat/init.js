sap.ui.define([
    "sap/ui/core/ComponentContainer"
], function (ComponentContainer) {
    "use strict";

    new ComponentContainer({
        name: "bpai",
        manifest: true,
        async: true,
        height: "100%",
        settings: { id: "bpai" }
    }).placeAt("content");
});
