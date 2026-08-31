const SERVICE = '/odata/v4/business-partner-ai';

const $messages = document.getElementById('messages');
const $form = document.getElementById('form');
const $input = document.getElementById('input');
const $send = document.getElementById('send');
const $diagram = document.getElementById('diagram');
const $steplist = document.getElementById('steplist');

/* ---------- diagram / steplist state ---------- */

const NODES = ['n-start', 'n-extract', 'n-fetch', 'n-decide', 'n-decision', 'n-ok', 'n-email'];

function setNode(id, cls) {
    const g = document.getElementById(id);
    if (!g) return;
    g.classList.remove('is-active', 'is-done', 'is-wait', 'is-error', 'is-muted');
    if (cls) g.classList.add(cls);
}
function setStep(step, cls) {
    const li = $steplist.querySelector(`li[data-step="${step}"]`);
    if (!li) return;
    li.classList.remove('is-active', 'is-done', 'is-wait', 'is-error');
    if (cls) li.classList.add(cls);
}
function resetDiagram() {
    NODES.forEach((id) => setNode(id, null));
    ['extract', 'fetch', 'decide', 'outcome'].forEach((s) => setStep(s, null));
    setNode('n-start', 'is-done');
}

/* ---------- chat helpers ---------- */

function addMsg(role, html, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = `msg msg--${role}` + (opts.error ? ' is-error' : '');
    const bubble = document.createElement('div');
    bubble.className = 'msg__bubble';
    if (opts.status) {
        const s = document.createElement('div');
        s.className = 'msg__status ' + (opts.statusKind || '');
        s.textContent = opts.status;
        bubble.appendChild(s);
    }
    const body = document.createElement('div');
    body.innerHTML = html;
    bubble.appendChild(body);
    wrap.appendChild(bubble);
    $messages.appendChild(wrap);
    $messages.scrollTop = $messages.scrollHeight;
    return { wrap, bubble, body };
}

function addTyping() {
    const { wrap, body } = addMsg('bot', '<span class="typing"><span></span><span></span><span></span></span>');
    return wrap;
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- email confirmation card ---------- */

function addEmailCard(container, draft) {
    const card = document.createElement('div');
    card.className = 'email';
    card.innerHTML = `
        <div class="email__title">Propozycja e-maila do partnera</div>
        <label>Do</label>
        <input class="to" type="email" placeholder="adres e-mail partnera" value="${esc(draft.to)}" />
        <label>Temat</label>
        <input class="subject" type="text" value="${esc(draft.subject)}" />
        <label>Treść</label>
        <textarea class="body">${esc(draft.body)}</textarea>
        <div class="email__actions">
            <button class="btn btn--emphasized confirm">Potwierdzam — wyślij</button>
            <button class="btn btn--transparent cancel">Anuluj</button>
        </div>
        <div class="email__result"></div>`;
    container.appendChild(card);

    const result = card.querySelector('.email__result');
    card.querySelector('.cancel').onclick = () => card.remove();
    card.querySelector('.confirm').onclick = async () => {
        const to = card.querySelector('.to').value.trim();
        if (!to) { result.textContent = 'Podaj adres e-mail.'; return; }
        card.querySelectorAll('button').forEach((b) => (b.disabled = true));
        result.textContent = 'Wysyłanie…';
        try {
            const headers = { 'Content-Type': 'application/json' };
            const token = await csrf();
            if (token) headers['x-csrf-token'] = token;
            const r = await fetch(`${SERVICE}/sendPartnerEmail`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    to,
                    subject: card.querySelector('.subject').value,
                    body: card.querySelector('.body').value
                })
            });
            const data = await r.json().catch(() => ({}));
            result.textContent = r.ok
                ? (data.value || 'Wysłano.')
                : (data.error?.message || `Błąd wysyłki (${r.status}).`);
        } catch (e) {
            result.textContent = 'Błąd: ' + e.message;
        }
    };
}

async function csrf() {
    try {
        const r = await fetch(`${SERVICE}/`, { headers: { 'x-csrf-token': 'fetch' } });
        return r.headers.get('x-csrf-token');
    } catch (_) {
        return null;
    }
}

/* ---------- run one query ---------- */

$form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $input.value.trim();
    if (!q) return;
    $input.value = '';
    ask(q);
});

function ask(query) {
    addMsg('user', esc(query));
    $send.disabled = true;
    resetDiagram();

    setNode('n-extract', 'is-active');
    setStep('extract', 'is-active');

    const typing = addTyping();
    let gotResult = false;
    let sawStream = false;

    const finish = () => {
        typing.remove();
        $send.disabled = false;
    };

    const showResult = (res) => {
        gotResult = true;
        finish();

        setNode('n-decide', 'is-done');
        setNode('n-decision', 'is-done');
        setStep('decide', 'is-done');

        if (res.decision === 'current') {
            setNode('n-ok', 'is-done');
            setNode('n-email', 'is-muted');
            setStep('outcome', 'is-done');
        } else {
            setNode('n-ok', 'is-muted');
            setNode('n-email', 'is-wait');
            setStep('outcome', 'is-wait');
        }

        const statusKind = res.decision === 'current' ? 'ok' : (res.requiresConfirmation ? 'warn' : 'err');
        const statusText = res.partnerId
            ? `Partner ${res.partnerId} · ${res.decision}`
            : (res.decision || 'wynik');

        const { body } = addMsg('bot', esc(res.message || '(brak odpowiedzi)'), {
            status: statusText,
            statusKind
        });
        if (res.requiresConfirmation && res.emailDraft) addEmailCard(body, res.emailDraft);
    };

    const showError = (msg) => {
        finish();
        addMsg('bot', esc(msg || 'Wystąpił błąd.'), { status: 'Błąd', statusKind: 'err', error: true });
        NODES.forEach((id) => {
            const g = document.getElementById(id);
            if (g && g.classList.contains('is-active')) setNode(id, 'is-error');
        });
        $steplist.querySelectorAll('li.is-active').forEach((li) => li.classList.replace('is-active', 'is-error'));
    };

    /* --- primary: SSE stream --- */
    let es;
    try {
        es = new EventSource(`/ai/ask-stream?query=${encodeURIComponent(query)}`);
    } catch (_) {
        return fallback(query, showResult, showError);
    }

    const linear = { extractPartner: 'extract', fetch: 'fetch', decide: 'decide' };
    const order = ['extractPartner', 'fetch', 'decide'];

    es.addEventListener('node', (ev) => {
        sawStream = true;
        const { node, update } = JSON.parse(ev.data);
        const errored = update && update.error;

        if (node === 'extractPartner') { setNode('n-extract', errored ? 'is-error' : 'is-done'); setStep('extract', errored ? 'is-error' : 'is-done'); }
        if (node === 'fetch') { setNode('n-fetch', errored ? 'is-error' : 'is-done'); setStep('fetch', errored ? 'is-error' : 'is-done'); }
        if (node === 'decide') { setNode('n-decide', 'is-done'); setStep('decide', 'is-done'); }

        const idx = order.indexOf(node);
        if (idx >= 0 && idx + 1 < order.length && !errored) {
            const next = order[idx + 1];
            setNode(next === 'fetch' ? 'n-fetch' : 'n-decide', 'is-active');
            setStep(linear[next], 'is-active');
        }
        if (node === 'fetch' && !errored) { setNode('n-decide', 'is-active'); setStep('decide', 'is-active'); }
        if (node === 'decide') { setNode('n-decision', 'is-active'); }
        if (node === 'decide' && update && update.decision) {
            setNode('n-decision', 'is-done');
            setNode(update.decision === 'current' ? 'n-ok' : 'n-email', 'is-active');
            setStep('outcome', 'is-active');
        }
    });

    es.addEventListener('result', (ev) => {
        es.close();
        showResult(JSON.parse(ev.data));
    });

    es.addEventListener('error', (ev) => {
        es.close();
        let msg = null;
        try { if (ev.data) msg = JSON.parse(ev.data).message; } catch (_) {}
        if (gotResult) return;
        if (msg) return showError(msg);
        // connection died before any usable data -> non-streaming fallback
        if (!sawStream) return fallback(query, showResult, showError);
        showError('Połączenie ze strumieniem zostało przerwane.');
    });
}

/* --- fallback: plain OData action (no live progress) --- */
async function fallback(query, showResult, showError) {
    // fake a bit of progress so the diagram still moves
    setNode('n-extract', 'is-done'); setStep('extract', 'is-done');
    setNode('n-fetch', 'is-active'); setStep('fetch', 'is-active');
    try {
        const headers = { 'Content-Type': 'application/json' };
        const token = await csrf();
        if (token) headers['x-csrf-token'] = token;
        const r = await fetch(`${SERVICE}/ask`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query })
        });
        const data = await r.json().catch(() => ({}));
        setNode('n-fetch', 'is-done'); setStep('fetch', 'is-done');
        if (!r.ok) return showError(data.error?.message || `Błąd (${r.status}).`);
        showResult(data);
    } catch (e) {
        showError(e.message);
    }
}

/* ---------- who am I (best effort) ---------- */
(async () => {
    try {
        const r = await fetch('/user-api/currentUser');
        if (!r.ok) return;
        const u = await r.json();
        const name = u.firstname || u.lastname ? `${u.firstname || ''} ${u.lastname || ''}`.trim() : u.name;
        if (name) {
            document.getElementById('avatar').textContent =
                name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
            document.getElementById('avatar').title = name;
        }
    } catch (_) { /* local dev: no auth */ }
})();

resetDiagram();
