service BusinessPartnerAIService {

    function getPartner() returns String;

    type EmailDraft {
        to      : String;
        subject : String;
        body    : LargeString;
    }

    type AskResult {
        partnerId            : String;
        decision             : String; // current | outdated | unknown
        message              : LargeString;
        emailDraft           : EmailDraft;
        requiresConfirmation : Boolean;
    }

    /**
     * Natural-language entry point.
     * Example query: "czy partner 5 ma ważny personal id?"
     * Runs a LangGraph flow: extract partner no. -> fetch identifications -> decide -> respond / draft e-mail.
     */
    action ask(query : String) returns AskResult;

    /**
     * Called by the UI only AFTER a human confirmed the drafted e-mail should really be sent.
     */
    action sendPartnerEmail(to : String, subject : String, body : LargeString) returns String;
}
