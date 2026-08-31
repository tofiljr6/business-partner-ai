/**
 * Local test of the LangGraph flow without CAP.
 *   BP_MOCK=true OPENAI_API_KEY=sk-... node scripts/test-graph.js "does partner 5 have a valid personal id?"
 */
const { runGraph } = require('../srv/lib/graph');

(async () => {
    const query = process.argv[2] || 'Does partner 0000000005 have a valid personal id?';
    const result = await runGraph(query);
    console.log(JSON.stringify(result, null, 2));
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
