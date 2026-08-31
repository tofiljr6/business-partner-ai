sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Core",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Input",
    "sap/m/TextArea",
    "sap/m/Label",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Text",
    "sap/m/MessageStrip",
    "sap/m/BusyIndicator"
], function (Controller, JSONModel, Core, MessageToast, Dialog, Button, Input, TextArea, Label, VBox, HBox, Text, MessageStrip, BusyIndicator) {
    "use strict";

    var SERVICE = "/odata/v4/business-partner-ai";

    var DIAGRAM = [
        '<div class="bpaiDiagram">',
        '<svg viewBox="0 0 380 470" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Process block diagram">',
        '  <defs>',
        '    <marker id="bpai-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">',
        '      <path d="M0,0 L10,5 L0,10 z" class="arrowhead" />',
        '    </marker>',
        '  </defs>',
        '  <path class="link" d="M140,44 L140,58" />',
        '  <path class="link" d="M140,102 L140,116" />',
        '  <path class="link" d="M140,160 L140,174" />',
        '  <path class="link" d="M140,218 L140,230" />',
        '  <path class="link" d="M140,338 L140,356" />',
        '  <path class="link" d="M140,400 L140,416" />',
        '  <path class="link" d="M240,286 L310,286 L310,300" />',
        '  <path class="link" d="M310,350 L310,364" />',
        '  <path class="link" d="M310,410 L310,424" />',
        '  <text class="edge-label" x="151" y="350">YES</text>',
        '  <text class="edge-label" x="258" y="279">NO</text>',
        '  <g class="node" id="n-start"><ellipse cx="140" cy="26" rx="66" ry="17" /><text x="140" y="30">User question</text></g>',
        '  <g class="node" id="n-extract"><rect x="40" y="58" width="200" height="44" rx="10" /><text x="140" y="76">1 · Extract partner</text><text x="140" y="90">number (LLM)</text></g>',
        '  <g class="node" id="n-fetch"><rect x="40" y="116" width="200" height="44" rx="10" /><text x="140" y="134">2 · Fetch identifications</text><text x="140" y="148">from SAP</text></g>',
        '  <g class="node" id="n-decide"><rect x="40" y="174" width="200" height="44" rx="10" /><text x="140" y="192">3 · Assess personal</text><text x="140" y="206">ID validity (LLM)</text></g>',
        '  <g class="node" id="n-decision"><polygon points="140,230 240,286 140,342 40,286" /><text x="140" y="282">Personal ID</text><text x="140" y="296">valid?</text></g>',
        '  <g class="node" id="n-ok"><rect x="40" y="356" width="200" height="44" rx="10" /><text x="140" y="374">On-screen message:</text><text x="140" y="388">ID is valid</text><ellipse cx="140" cy="433" rx="52" ry="16" /><text x="140" y="437">End</text></g>',
        '  <g class="node" id="n-email"><rect x="250" y="300" width="120" height="50" rx="10" /><text x="310" y="322">Draft email</text><text x="310" y="336">(LLM)</text><polygon points="258,364 362,364 354,410 266,410" /><text x="310" y="384">Human</text><text x="310" y="398">confirms</text><ellipse cx="310" cy="440" rx="52" ry="16" /><text x="310" y="444">Send</text></g>',
        '</svg>',
        '</div>'
    ].join("");

    return Controller.extend("bpai.controller.App", {

        onInit: function () {
            this._t = this.getOwnerComponent().getModel("i18n").getResourceBundle();

            this._model = new JSONModel({
                busy: false,
                steps: [
                    { key: "extract", text: this._t.getText("step1"), state: "None" },
                    { key: "fetch", text: this._t.getText("step2"), state: "None" },
                    { key: "decide", text: this._t.getText("step3"), state: "None" },
                    { key: "outcome", text: this._t.getText("step4"), state: "None" }
                ]
            });
            this.getView().setModel(this._model);

            this.byId("diagram").setContent(DIAGRAM);
            this._applyThemeClass(Core.getConfiguration().getTheme());
            this._resetDiagram();

            this._addBubble("bot", this._t.getText("welcomeMessage"));
            this._loadUser();
        },

        /* ---------------- UI actions ---------------- */

        onToggleTheme: function () {
            var next = Core.getConfiguration().getTheme() === "sap_horizon_dark" ? "sap_horizon" : "sap_horizon_dark";
            Core.applyTheme(next);
            this._applyThemeClass(next);
        },

        _applyThemeClass: function (theme) {
            var dark = /dark|hcb|_dark/i.test(theme);
            document.body.classList.toggle("bpai-theme-dark", dark);
            document.body.classList.toggle("bpai-theme-light", !dark);
        },

        onSend: function () {
            var input = this.byId("queryInput");
            var query = (input.getValue() || "").trim();
            if (!query || this._model.getProperty("/busy")) {
                return;
            }
            input.setValue("");
            this._ask(query);
        },

        /* ---------------- flow ---------------- */

        _ask: function (query) {
            var that = this;
            this._setBusy(true);
            this._addBubble("user", query);
            this._resetDiagram();
            this._setNode("n-extract", "is-active");
            this._setStep("extract", "Active");

            var typing = this._addTyping();
            var done = false;
            var sawStream = false;

            var finish = function () {
                typing.destroy();
                that._setBusy(false);
            };

            var showResult = function (res) {
                done = true;
                finish();
                that._setNode("n-decide", "is-done");
                that._setNode("n-decision", "is-done");
                that._setStep("decide", "Done");

                if (res.decision === "current") {
                    that._setNode("n-ok", "is-done");
                    that._setNode("n-email", "is-muted");
                    that._setStep("outcome", "Done");
                } else {
                    that._setNode("n-ok", "is-muted");
                    that._setNode("n-email", "is-wait");
                    that._setStep("outcome", "Wait");
                }

                var strip = null;
                if (res.partnerId && res.decision === "current") {
                    strip = { type: "Success", text: that._t.getText("resultValid", [res.partnerId]) };
                } else if (res.partnerId) {
                    strip = { type: res.requiresConfirmation ? "Warning" : "Error", text: that._t.getText("resultOutdated", [res.partnerId, res.decision]) };
                } else {
                    strip = { type: "Information", text: that._t.getText("resultNoPartner") };
                }

                that._addBubble("bot", res.message || "—", strip);
                if (res.requiresConfirmation && res.emailDraft) {
                    that._openEmailDialog(res.emailDraft);
                }
            };

            var showError = function (msg) {
                finish();
                that._addBubble("bot", msg || that._t.getText("errorLabel"), { type: "Error", text: that._t.getText("errorLabel") });
                ["n-extract", "n-fetch", "n-decide", "n-decision"].forEach(function (id) {
                    var g = that._nodeEl(id);
                    if (g && g.classList.contains("is-active")) {
                        that._setNode(id, "is-error");
                    }
                });
                var steps = that._model.getProperty("/steps");
                steps.forEach(function (s) { if (s.state === "Active") { s.state = "Error"; } });
                that._model.setProperty("/steps", steps);
            };

            var es;
            try {
                es = new EventSource("/ai/ask-stream?query=" + encodeURIComponent(query));
            } catch (e) {
                return this._fallback(query, showResult, showError);
            }

            var order = ["extractPartner", "fetch", "decide"];
            var stepOf = { extractPartner: "extract", fetch: "fetch", decide: "decide" };
            var nodeOf = { extractPartner: "n-extract", fetch: "n-fetch", decide: "n-decide" };

            es.addEventListener("node", function (ev) {
                sawStream = true;
                var data = JSON.parse(ev.data);
                var node = data.node;
                var update = data.update || {};
                var errored = !!update.error;

                if (nodeOf[node]) {
                    that._setNode(nodeOf[node], errored ? "is-error" : "is-done");
                    that._setStep(stepOf[node], errored ? "Error" : "Done");
                }

                var idx = order.indexOf(node);
                if (idx >= 0 && idx + 1 < order.length && !errored) {
                    var next = order[idx + 1];
                    that._setNode(nodeOf[next], "is-active");
                    that._setStep(stepOf[next], "Active");
                }
                if (node === "decide") {
                    that._setNode("n-decision", "is-active");
                    if (update.decision) {
                        that._setNode("n-decision", "is-done");
                        that._setNode(update.decision === "current" ? "n-ok" : "n-email", "is-active");
                        that._setStep("outcome", "Active");
                    }
                }
            });

            es.addEventListener("result", function (ev) {
                es.close();
                showResult(JSON.parse(ev.data));
            });

            es.addEventListener("error", function (ev) {
                es.close();
                if (done) { return; }
                var msg = null;
                try { if (ev.data) { msg = JSON.parse(ev.data).message; } } catch (e) { /* noop */ }
                if (msg) { return showError(msg); }
                if (!sawStream) { return that._fallback(query, showResult, showError); }
                showError(that._t.getText("streamInterrupted"));
            });
        },

        _fallback: function (query, showResult, showError) {
            var that = this;
            this._setNode("n-extract", "is-done");
            this._setStep("extract", "Done");
            this._setNode("n-fetch", "is-active");
            this._setStep("fetch", "Active");

            this._csrf().then(function (token) {
                var headers = { "Content-Type": "application/json" };
                if (token) { headers["x-csrf-token"] = token; }
                return fetch(SERVICE + "/ask", {
                    method: "POST",
                    headers: headers,
                    body: JSON.stringify({ query: query })
                });
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (data) {
                    that._setNode("n-fetch", "is-done");
                    that._setStep("fetch", "Done");
                    if (!r.ok) { return showError((data.error && data.error.message) || ("HTTP " + r.status)); }
                    showResult(data);
                });
            }).catch(function (e) {
                showError(e.message);
            });
        },

        /* ---------------- email dialog ---------------- */

        _openEmailDialog: function (draft) {
            var that = this;
            var oTo = new Input({ value: draft.to || "", type: "Email" });
            var oSubject = new Input({ value: draft.subject || "" });
            var oBody = new TextArea({ value: draft.body || "", rows: 9, width: "100%", growing: true });

            var oDialog = new Dialog({
                title: this._t.getText("emailDialogTitle"),
                contentWidth: "36rem",
                draggable: true,
                content: new VBox({
                    class: "bpaiDialogForm",
                    items: [
                        new Label({ text: this._t.getText("emailTo"), labelFor: oTo }), oTo,
                        new Label({ text: this._t.getText("emailSubject"), labelFor: oSubject }), oSubject,
                        new Label({ text: this._t.getText("emailBody"), labelFor: oBody }), oBody
                    ]
                }),
                beginButton: new Button({
                    text: this._t.getText("emailSendConfirm"),
                    type: "Emphasized",
                    icon: "sap-icon://email",
                    press: function () {
                        var to = (oTo.getValue() || "").trim();
                        if (!to) {
                            oTo.setValueState("Error").setValueStateText(that._t.getText("emailToRequired"));
                            return;
                        }
                        oDialog.setBusy(true);
                        that._sendEmail({ to: to, subject: oSubject.getValue(), body: oBody.getValue() })
                            .then(function (msg) {
                                oDialog.setBusy(false);
                                MessageToast.show(msg);
                                oDialog.close();
                            })
                            .catch(function (e) {
                                oDialog.setBusy(false);
                                MessageToast.show(String(e && e.message || e));
                            });
                    }
                }),
                endButton: new Button({
                    text: this._t.getText("emailCancel"),
                    press: function () { oDialog.close(); }
                }),
                afterClose: function () { oDialog.destroy(); }
            });

            oDialog.addStyleClass("sapUiContentPadding");
            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        _sendEmail: function (payload) {
            return this._csrf().then(function (token) {
                var headers = { "Content-Type": "application/json" };
                if (token) { headers["x-csrf-token"] = token; }
                return fetch(SERVICE + "/sendPartnerEmail", {
                    method: "POST",
                    headers: headers,
                    body: JSON.stringify(payload)
                });
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (data) {
                    if (!r.ok) { throw new Error((data.error && data.error.message) || ("HTTP " + r.status)); }
                    return data.value || "OK";
                });
            });
        },

        _csrf: function () {
            return fetch(SERVICE + "/", { headers: { "x-csrf-token": "fetch" } })
                .then(function (r) { return r.headers.get("x-csrf-token"); })
                .catch(function () { return null; });
        },

        /* ---------------- chat rendering ---------------- */

        _addBubble: function (role, text, strip) {
            var items = [];
            if (strip) {
                items.push(new MessageStrip({
                    text: strip.text,
                    type: strip.type,
                    showIcon: true
                }).addStyleClass("sapUiTinyMarginBottom"));
            }
            items.push(new Text({ text: text }).addStyleClass("bpaiBubbleText"));

            var bubble = new VBox({ items: items }).addStyleClass("bpaiBubble bpaiBubble--" + role);
            var row = new HBox({
                justifyContent: role === "user" ? "End" : "Start",
                items: [bubble]
            }).addStyleClass("bpaiRow");

            this.byId("messages").addItem(row);
            this._scrollDown();
            return row;
        },

        _addTyping: function () {
            var row = new HBox({
                justifyContent: "Start",
                items: [
                    new VBox({
                        items: [new BusyIndicator({ size: "1.25rem" })]
                    }).addStyleClass("bpaiBubble bpaiBubble--bot")
                ]
            }).addStyleClass("bpaiRow");
            this.byId("messages").addItem(row);
            this._scrollDown();
            return row;
        },

        _scrollDown: function () {
            var sc = this.byId("scroll");
            setTimeout(function () {
                var dom = sc.getDomRef();
                if (dom) {
                    var inner = dom.querySelector(".sapMScrollContScroll") || dom;
                    inner.scrollTop = inner.scrollHeight;
                }
            }, 50);
        },

        /* ---------------- diagram + steps ---------------- */

        _nodeEl: function (id) {
            var root = this.byId("diagram").getDomRef();
            return root ? root.querySelector("#" + id) : null;
        },

        _setNode: function (id, cls) {
            var g = this._nodeEl(id);
            if (!g) { return; }
            ["is-active", "is-done", "is-wait", "is-error", "is-muted"].forEach(function (c) { g.classList.remove(c); });
            if (cls) { g.classList.add(cls); }
        },

        _setStep: function (key, state) {
            var steps = this._model.getProperty("/steps");
            for (var i = 0; i < steps.length; i++) {
                if (steps[i].key === key) { steps[i].state = state; break; }
            }
            this._model.setProperty("/steps", steps);
        },

        _resetDiagram: function () {
            ["n-start", "n-extract", "n-fetch", "n-decide", "n-decision", "n-ok", "n-email"].forEach(function (id) {
                this._setNode(id, null);
            }, this);
            this._setNode("n-start", "is-done");
            var steps = this._model.getProperty("/steps");
            steps.forEach(function (s) { s.state = "None"; });
            this._model.setProperty("/steps", steps);
        },

        _setBusy: function (b) {
            this._model.setProperty("/busy", b);
            this.byId("sendBtn").setEnabled(!b);
            this.byId("queryInput").setEnabled(!b);
        },

        /* ---------------- misc ---------------- */

        _loadUser: function () {
            var avatar = this.byId("avatar");
            fetch("/user-api/currentUser").then(function (r) {
                return r.ok ? r.json() : null;
            }).then(function (u) {
                if (!u) { return; }
                var name = (u.firstname || u.lastname)
                    ? ((u.firstname || "") + " " + (u.lastname || "")).trim()
                    : u.name;
                if (name) {
                    avatar.setInitials(name.split(/\s+/).map(function (s) { return s[0]; }).slice(0, 2).join("").toUpperCase());
                    avatar.setTooltip(name);
                }
            }).catch(function () { /* local dev: no auth */ });
        }
    });
});
