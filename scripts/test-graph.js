/**
 * Lokalny test przepływu LangGraph bez CAP.
 *   BP_MOCK=true OPENAI_API_KEY=sk-... node scripts/test-graph.js "czy partner 5 ma wazny personal id?"
 */
const { runGraph } = require('../srv/lib/graph');

(async () => {
    const query = process.argv[2] || 'Czy partner 0000000005 ma ważny personal id?';
    const result = await runGraph(query);
    console.log(JSON.stringify(result, null, 2));
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
