// Synthetic, versioned knowledge. These fixtures are not claims about the owner
// and never read or modify the live knowledge collection.
const chunks = [
  [
    "identity",
    "Topic: Name\nAnswer: Mira Sen.\nSearch phrases: who are you, name, identity.\nTags: name, identity, who-are-you.",
  ],
  [
    "career",
    "Topic: Current Designation\nAnswer: Platform Engineer at Northstar Labs.\nSearch phrases: designation, job title, occupation, profession.\nTags: career, current-designation.",
  ],
  [
    "company",
    "Topic: Current Organization\nAnswer: Northstar Labs.\nSearch phrases: employer, company, where do you work.",
  ],
  [
    "project",
    "Topic: Atlas project\nAnswer: Atlas organizes research notes with semantic search.\nSearch phrases: Atlas features, research notes, semantic search.",
  ],
  [
    "contact",
    "Topic: Contact\nAnswer: Use the contact form on the portfolio.\nSearch phrases: contact, get in touch.",
  ],
  [
    "hobbies",
    "Topic: Hobbies\nAnswer: Hiking and watercolor painting.\nSearch phrases: hobbies, free time, interests.",
  ],
  [
    "files",
    "Topic: Supported files\nAnswer: AmiBot accepts PDF and Excel XLSX files.\nSearch phrases: upload, supported files, formats, PDF, Excel.",
  ],
  [
    "semantic",
    "Topic: Learning\nAnswer: Studies distributed systems.",
    [0.99, 0.1, 0],
  ],
].map(([id, chunkText, embedding], index) => ({
  _id: id,
  sourceId: "fixture-source",
  sourceName: "Synthetic profile",
  chunkIndex: index,
  chunkText,
  embedding,
}));

const cases = [
  {
    title: "Natural identity question",
    query: "Who are you?",
    expected: ["identity"],
  },
  {
    title: "Exact job title",
    query: "What is your designation?",
    expected: ["career"],
  },
  {
    title: "Employer lookup",
    query: "Which company is your employer?",
    expected: ["company"],
  },
  {
    title: "Project capabilities",
    query: "What are the Atlas project features?",
    expected: ["project"],
  },
  {
    title: "Contact paraphrase",
    query: "How do I get in touch?",
    expected: ["contact"],
  },
  {
    title: "Personal interests",
    query: "What are your hobbies?",
    expected: ["hobbies"],
  },
  {
    title: "Supported upload formats",
    query: "Which file formats can I upload, PDF or Excel?",
    expected: ["files"],
  },
  {
    title: "Follow-up stays on current question",
    query: "What about designation?",
    history: "Which company is your employer? Northstar Labs.",
    expected: ["career"],
  },
  {
    title: "Unrelated topic retrieves nothing",
    query: "quasar luminosity spectroscopy",
    expected: [],
  },
  {
    title: "Punctuation and case",
    query: "ATLAS?! research NOTES!",
    expected: ["project"],
  },
  {
    title: "Multiple requested records",
    query: "Atlas project and hobbies",
    expected: ["project", "hobbies"],
    topK: 2,
  },
  {
    title: "Semantic-only retrieval",
    query: "scholarship",
    expected: ["semantic"],
    embedding: [1, 0, 0],
  },
  { title: "Greeting bypasses retrieval", query: "Hi", direct: true },
  { title: "Thanks bypasses retrieval", query: "Thank you", direct: true },
];

module.exports = { chunks, cases };
