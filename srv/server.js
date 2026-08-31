const cds = require('@sap/cds');
const { compiled } = require('./lib/graph');

/**
 * Custom Express routes added on top of the CAP server.
 * SSE endpoint that streams LangGraph progress node-by-node so the chat UI
 * can show what is happening live.
 */
cds.on('bootstrap', (app) => {

    app.get('/ai/ask-stream', async (req, res) => {
        const query = (req.query.query || '').toString();

        res.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            Connection: 'keep-alive'
        });
        if (res.flushHeaders) res.flushHeaders();

        const send = (event, data) => {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // keep the connection visibly alive while LLM calls run
        res.write(': connected\n\n');
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 5000);
        res.on('close', () => clearInterval(heartbeat));

        if (!query.trim()) {
            send('error', { message: 'Brak parametru "query".' });
            return res.end();
        }

        send('start', { query });

        try {
            let state = {};
            const stream = await compiled.stream({ query }, { streamMode: 'updates' });
            for await (const chunk of stream) {
                for (const [node, update] of Object.entries(chunk)) {
                    state = { ...state, ...update };
                    send('node', { node, update });
                }
            }

            send('result', {
                partnerId: state.partnerId || null,
                decision: state.decision || 'unknown',
                message: state.message || '',
                emailDraft: state.emailDraft || null,
                requiresConfirmation: !!state.requiresConfirmation
            });
        } catch (e) {
            console.error('ask-stream failed', e);
            send('error', { message: e.message || String(e) });
        } finally {
            clearInterval(heartbeat);
            res.end();
        }
    });
});

module.exports = cds.server;
