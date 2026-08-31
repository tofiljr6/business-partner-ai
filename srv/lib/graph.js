const { StateGraph, Annotation, START, END } = require('@langchain/langgraph');
const { ChatOpenAI } = require('@langchain/openai');
const { z } = require('zod');
const { fetchIdentifications } = require('./bpClient');

// Custom dispatcher: short keep-alive avoids "Premature close" from stale
// sockets (VPN / TLS-inspecting firewalls drop idle connections silently),
// and honours HTTPS_PROXY / HTTP_PROXY if set.
let dispatcher;
try {
    const undici = require('undici');
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    dispatcher = proxyUrl
        ? new undici.ProxyAgent(proxyUrl)
        : new undici.Agent({ keepAliveTimeout: 10, keepAliveMaxTimeout: 10, connections: 64, pipelining: 0 });
} catch (_) {
    dispatcher = null;
}

async function resilientFetch(url, init) {
    if (dispatcher) {
        const { fetch: undiciFetch } = require('undici');
        return undiciFetch(url, { ...init, dispatcher });
    }
    return fetch(url, init);
}

/**
 * OPENAI_API_KEY env var wins; on BTP fall back to a bound service
 * (e.g. user-provided service created with `cf cups ... -p '{"OPENAI_API_KEY":"sk-..."}'`).
 */
function openAIConfig() {
    const cfg = {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
        baseURL: process.env.OPENAI_BASE_URL
    };
    try {
        const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
        for (const instances of Object.values(vcap)) {
            for (const svc of instances) {
                const c = svc.credentials || {};
                cfg.apiKey = cfg.apiKey || c.OPENAI_API_KEY || c.openai_api_key ||
                    (/openai/i.test(svc.name || '') ? c.apikey : undefined);
                cfg.model = cfg.model || c.OPENAI_MODEL || c.openai_model;
                cfg.baseURL = cfg.baseURL || c.OPENAI_BASE_URL || c.openai_base_url;
            }
        }
    } catch (_) { /* ignore */ }
    return cfg;
}

function model() {
    const cfg = openAIConfig();
    return new ChatOpenAI({
        model: cfg.model || 'gpt-4o-mini',
        temperature: 0,
        apiKey: cfg.apiKey,
        maxRetries: 4,
        timeout: 60000,
        configuration: {
            fetch: resilientFetch,
            baseURL: cfg.baseURL || undefined
        }
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
                .describe('The business partner number from the query, digits only. Empty string if none.')
        })
    );

    const res = await llm.invoke([
        {
            role: 'system',
            content:
                'Extract the business partner number from the user query. ' +
                'Return digits only, without leading zeros. If there is no number, return an empty string.'
        },
        { role: 'user', content: state.query }
    ]);

    if (!res.partnerId) {
        return { error: 'Could not find a partner number in the query.' };
    }
    return { partnerId: res.partnerId };
}

// 2. Deterministic call to the already-tested backend service.
async function fetchNode(state) {
    try {
        const identifications = await fetchIdentifications(state.partnerId);
        return { identifications };
    } catch (e) {
        return { error: `Failed to fetch the partner's identifications: ${e.message}` };
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
                `You assess whether a business partner has a valid (current) personal ID / personnel identifier.\n` +
                `Today's date: ${today}.\n` +
                `Analyse the list of identifications. Look at the type that marks a personal/personnel ID and at the ` +
                `validity date fields (ValidityEndDate / ValidTo / Valid_To, etc.).\n` +
                `- 'current': a personal ID exists that is valid as of today.\n` +
                `- 'outdated': a personal ID exists but has expired, or there is no valid one.\n` +
                `- 'unknown': it cannot be determined from the data.\n` +
                `Write the explanation in English.`
        },
        {
            role: 'user',
            content:
                `User query: ${state.query}\n\n` +
                `Identifications (JSON):\n${JSON.stringify(state.identifications, null, 2)}`
        }
    ]);

    return { decision: res.decision, explanation: res.explanation };
}

// 4a. Everything fine -> just report on screen.
function okNode(state) {
    return {
        message: `Partner ${state.partnerId} has a current personal ID. ${state.explanation}`,
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
                'Write a polite, formal email in English to the business partner asking them to confirm or update ' +
                'their personal ID, which appears to be out of date. Keep it concise, no fluff. ' +
                'Do not invent contact details or names.'
        },
        { role: 'user', content: `Partner number: ${state.partnerId}\nReason for contact: ${state.explanation}` }
    ]);

    return {
        message:
            `Personal ID of partner ${state.partnerId} appears to be out of date (${state.decision}). ` +
            `A draft email has been prepared — please confirm whether to send it.`,
        emailDraft: { to: '', subject: res.subject, body: res.body },
        requiresConfirmation: true
    };
}

function failNode(state) {
    return {
        message: state.error || 'An unknown error occurred.',
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
