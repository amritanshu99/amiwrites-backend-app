const {
  scoreKnowledgeChunks,
  getDirectAmiBotReply,
} = require("../../utils/amibotKnowledge");
const { chunks, cases } = require("./fixtures");

function runOfflineEvals() {
  return cases.map((item) => {
    if (item.direct)
      return {
        title: item.title,
        passed: Boolean(getDirectAmiBotReply(item.query)),
        expected: "direct reply",
        actual: getDirectAmiBotReply(item.query)?.type || "retrieval",
      };
    const actual = scoreKnowledgeChunks(chunks, item.query, {
      primaryWeight: 3,
      supplementalWeight: 1,
      supplementalQuery: item.history || "",
      semanticQueryEmbedding: item.embedding || [],
      semanticWeight: 10,
      minSemanticScore: 0.35,
    })
      .slice(0, item.topK || 1)
      .map((chunk) => chunk._id);
    const passed = item.expected.length
      ? item.expected.every((id) => actual.includes(id))
      : actual.length === 0;
    return { title: item.title, passed, expected: item.expected, actual };
  });
}

if (require.main === module) {
  const results = runOfflineEvals();
  const passed = results.filter((result) => result.passed).length;
  if (process.argv.includes("--json"))
    console.log(
      JSON.stringify(
        { mode: "offline-fixtures", passed, total: results.length, results },
        null,
        2,
      ),
    );
  else {
    console.log(
      "AmiBot offline retrieval regression suite (synthetic fixtures; no model calls)",
    );
    results.forEach((result) =>
      console.log(
        `${result.passed ? "PASS" : "FAIL"}  ${result.title}${result.passed ? "" : ` | expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`}`,
      ),
    );
    console.log(
      `\n${passed}/${results.length} passed. This checks ranking and direct routing, not generated-answer quality.`,
    );
  }
  if (passed !== results.length) process.exitCode = 1;
}

module.exports = { runOfflineEvals };
