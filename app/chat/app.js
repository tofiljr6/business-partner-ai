const SERVICE = '/odata/v4/business-partner-ai';

const $messages = document.getElementById('messages');
const $form = document.getElementById('form');
const $input = document.getElementById('input');
const $send = document.getElementById('send');
const $graph = document.getElementById('graph');
const $log = document.getElementById('event-log');

/** Static description of the graph. `next` drives the "running" highlight. */
const FLOW = [
    { id: 'extractPartner', name: '1. extractPartner', desc: 'LLM wyciąga numer partnera z zapytania' },
    { id: 'fetch', name: '2. fetch', desc: 'Pobranie identyfikacji z SAP dla tego numeru' },
    { id: 'decide', name: '3. decide', desc: 'LLM ocenia ważność personal ID' }
];
const BRANCH = [
    { id: 'ok', name: 'ok', desc: 'aktualny' },
    { id: 'draft', name: 'draft', desc: 'propozycja e-maila' },
    { id: 'fail', name: 'fail', desc: 'błąd' }
];

function renderGraph(states = {}) {
    const nodeHtml = (n) => `
        <div class="node ${states[n.id] || 'pending'}" data-id="${n.id}">
            <div class="name">${n.name}</div>
            <div class="desc">${n.desc}</div>
            <div class="state"></div>
        </div>`;

    $graph.innerHTML =
        FLOW.map(nodeHtml).join('') +
        `<div class="branch">${BRANCH.map(nodeHtml).join('')}</div>`;
}
renderGraph();

function logLine(text) {
    $log.textContent += (text + '\n');
    $log.scrollTop = $log.scrollHeight;
}

function addMsg(role, text, opts = {}) {
    const el = document.createElement('div');
    el.className = `msg ${role}` + (opts.error ? ' err' : '');
    if (opts.tag) {
        const tag = document.createElement('span');
        tag.className = 'tag ' + (opts.tagKind || '');
        tag.textContent = opts.tag;
        el.appendChild(tag);
    }
    const body = document.createElement('div');
    body.textContent = text;
    el.appendChild(body);
    $messages.appendChild(el);
    $messages.scrollTop = $messages.scrollHeight;
    return el;
}

function addEmailCard(parent, draft) {
    const card = document.createElement('div');
    card.className = 'email-card';
    card.innerHTML = `
        <label>Do</label>
        <input class="to" type="email" placeholder="adres e-mail partnera" value="${draft.to || ''}" />
        <label>Temat</label>
        <input class="subject" type="text" value="${escapeAttr(draft.subject || '')}" />
        <label>Treść</label>
        <textarea class="body">${escapeHtml(draft.body || '')}</textarea>
        <div class="actions">
            <button class="confirm">Potwierdzam – wyślij</button>
            <button class="secondary cancel">Anuluj</button>
        </div>
        <div class="result"></div>`;
    parent.appendChild(card);

    const result = card.querySelector('.result');
    card.querySelector('.cancel').onclick = () => card.remove();
    card.querySelector('.confirm').onclick = async () => {
        const to = card.querySelector('.to').value.trim();
        if (!to) { result.textContent = 'Podaj adres e-mail.'; return; }
        card.querySelectorAll('button').forEach((b) => (b.disabled = true));
        result.textContent = 'Wysyłanie…';
        try {
            const r = await fetch(`${SERVICE}/sendPartnerEmail`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to,
                    subject: card.querySelector('.subject').value,
                    body: card.querySelector('.body').value
                })
            });
            const data = await r.json();
            result.textContent = r.ok ? (data.value || 'Wysłano.') : (data.error?.message || 'Błąd wysyłki.');
        } catch (e) {
            result.textContent = 'Błąd: ' + e.message;
        }
    };
}

function escapeHtml(s) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return s.replace(/"/g, '&quot;'); }

$form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = $input.value.trim();
    if (!query) return;
    ask(query);
    $input.value = '';
});

function ask(query) {
    addMsg('user', query);
    $send.disabled = true;
    $log.textContent = '';

    const states = {};
    renderGraph(states);

    // mark first node running
    states.extractPartner = 'running';
    renderGraph(states);

    const order = ['extractPartner', 'fetch', 'decide'];
    const es = new EventSource(`/ai/ask-stream?query=${encodeURIComponent(query)}`);

    es.addEventListener('start', () => logLine('▶ start'));

    es.addEventListener('node', (ev) => {
        const { node, update } = JSON.parse(ev.data);
        logLine(`● ${node} ${JSON.stringify(update)}`);

        states[node] = update && update.error ? 'error' : 'done';

        // light up the next linear node
        const idx = order.indexOf(node);
        if (idx >= 0 && idx + 1 < order.length && !states[order[idx + 1]]) {
            states[order[idx + 1]] = 'running';
        }
        // after decide, the branch target starts running
        if (node === 'decide' && update && update.decision) {
            const target = update.decision === 'current' ? 'ok' : 'draft';
            states[target] = 'running';
        }
        renderGraph(states);
    });

    es.addEventListener('result', (ev) => {
        const res = JSON.parse(ev.data);
        es.close();
        $send.disabled = false;

        // finalize branch state
        BRANCH.forEach((b) => { if (states[b.id] === 'running') states[b.id] = 'done'; });
        // dim untaken branches
        BRANCH.forEach((b) => { if (!states[b.id]) states[b.id] = 'skipped'; });
        renderGraph(states);

        const kind = res.decision === 'current' ? 'ok' : (res.requiresConfirmation ? 'warn' : 'err');
        const tag = res.partnerId ? `partner ${res.partnerId} · ${res.decision}` : res.decision;
        const el = addMsg('bot', res.message || '(brak odpowiedzi)', { tag, tagKind: kind });

        if (res.requiresConfirmation && res.emailDraft) {
            addEmailCard(el, res.emailDraft);
        }
        logLine('■ done');
    });

    es.addEventListener('error', (ev) => {
        es.close();
        $send.disabled = false;
        let msg = 'Błąd połączenia ze strumieniem.';
        try { if (ev.data) msg = JSON.parse(ev.data).message; } catch (_) {}
        addMsg('bot', msg, { tag: 'błąd', tagKind: 'err', error: true });
        Object.keys(states).forEach((k) => { if (states[k] === 'running') states[k] = 'error'; });
        renderGraph(states);
        logLine('✕ ' + msg);
    });
}
