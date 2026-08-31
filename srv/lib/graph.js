const { StateGraph, Annotation, START, END } = require('@langchain/langgraph');
const { ChatOpenAI } = require('@langchain/openai');
const { z } = require('zod');
const { fetchIdentifications } = require('./bpClient');

function model() {
    return new ChatOpenAI({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY
    });
}

const State = Annotation.Root({
    query: Annotation,
    partnerId: Annotation,
    identifications: Annotation,
    decision: Annotation,             // 'current' | 'outdated' | 'unknown'
    explanation: Annotation,
    message: Annotation,
    emailDraft: Annotation,           // { to, subject, body }
    requiresConfirmation: Annotation,
    error: Annotation
});

// 1. LLM pulls the business partner number out of the free-text query.
async function extractPartner(state) {
    const llm = model().withStructuredOutput(
        z.object({
            partnerId: z
                .string()
                .describe('Numer business partnera z zapytania, same cyfry. Pusty string jeśli brak.')
        })
    );

    const res = await llm.invoke([
        {
            role: 'system',
            content:
                'Wyodrębnij numer business partnera z zapytania użytkownika. Zwróć same cyfry, bez wiodących zer. Jeśli numeru nie ma, zwróć pusty string.'
        },
        { role: 'user', content: state.query }
    ]);

    if (!res.partnerId) {
        return { error: 'Nie udało się znaleźć numeru partnera w zapytaniu.' };
    }
    return { partnerId: res.partnerId };
}

// 2. Deterministic call to the already-tested backend service.
async function fetchNode(state) {
    try {
        const identifications = await fetchIdentifications(state.partnerId);
        return { identifications };
    } catch (e) {
        return { error: `Błąd pobierania identyfikacji partnera: ${e.message}` };
    }
}

// 3. LLM decides whether the personal id is still valid as of today.
async function decideNode(state) {
    const llm = model().withStructuredOutput(
        z.object({
            decision: z.enum(['current', 'outdated', 'unknown']),
            explanation: z.string()
        })
    );

    const today = new Date().toISOString().slice(0, 10);

    const res = await llm.invoke([
        {
            role: 'system',
            content:
                `Oceniasz, czy business partner ma ważny (aktualny) personal id / identyfikator osobowy.\n` +
                `Dzisiejsza data: ${today}.\n` +
                `Przeanalizuj listę identyfikacji. Zwróć uwagę na typ oznaczający personal/personnel id oraz pola dat ważności ` +
                `(ValidityEndDate / ValidTo / Valid_To itp.).\n` +
                `- 'current': istnieje personal id ważny na dziś.\n` +
                `- 'outdated': personal id istnieje, ale wygasł lub nie ma żadnego ważnego.\n` +
                `- 'unknown': nie da się ustalić z danych.`
        },
        {
            role: 'user',
            content:
                `Zapytanie użytkownika: ${state.query}\n\n` +
                `Identyfikacje (JSON):\n${JSON.stringify(state.identifications, null, 2)}`
        }
    ]);

    return { decision: res.decision, explanation: res.explanation };
}

// 4a. Everything fine -> just report on screen.
function okNode(state) {
    return {
        message: `Partner ${state.partnerId} ma aktualny personal id. ${state.explanation}`,
        emailDraft: null,
        requiresConfirmation: false
    };
}

// 4b. Not fine -> draft an e-mail for a human to review before sending.
async function draftEmailNode(state) {
    const llm = model().withStructuredOutput(
        z.object({
            subject: z.string(),
            body: z.string()
        })
    );

    const res = await llm.invoke([
        {
            role: 'system',
            content:
                'Napisz uprzejmy, formalny e-mail po polsku do business partnera z prośbą o potwierdzenie lub aktualizację ' +
                'jego personal id, który wygląda na nieaktualny. Zwięźle, bez zbędnych ozdobników. Nie wymyślaj danych kontaktowych.'
        },
        { role: 'user', content: `Numer partnera: ${state.partnerId}\nPowód kontaktu: ${state.explanation}` }
    ]);

    return {
        message:
            `Personal id partnera ${state.partnerId} wygląda na nieaktualny (${state.decision}). ` +
            `Przygotowano propozycję e-maila — potwierdź, czy wysłać.`,
        emailDraft: { to: '', subject: res.subject, body: res.body },
        requiresConfirmation: true
    };
}

function failNode(state) {
    return {
        message: state.error || 'Wystąpił nieznany błąd.',
        emailDraft: null,
        requiresConfirmation: false
    };
}

const compiled = new StateGraph(State)
    .addNode('extractPartner', extractPartner)
    .addNode('fetch', fetchNode)
    .addNode('decide', decideNode)
    .addNode('ok', okNode)
    .addNode('draft', draftEmailNode)
    .addNode('fail', failNode)
    .addEdge(START, 'extractPartner')
    .addConditionalEdges('extractPartner', (s) => (s.error ? 'fail' : 'fetch'), {
        fail: 'fail',
        fetch: 'fetch'
    })
    .addConditionalEdges('fetch', (s) => (s.error ? 'fail' : 'decide'), {
        fail: 'fail',
        decide: 'decide'
    })
    .addConditionalEdges(
        'decide',
        (s) => {
            if (s.error) return 'fail';
            return s.decision === 'current' ? 'ok' : 'draft';
        },
        { fail: 'fail', ok: 'ok', draft: 'draft' }
    )
    .addEdge('ok', END)
    .addEdge('draft', END)
    .addEdge('fail', END)
    .compile();

async function runGraph(query) {
    return compiled.invoke({ query });
}

module.exports = { runGraph, compiled };
