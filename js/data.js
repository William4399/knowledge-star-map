export const Data = {
  loaded: false,
  meta: {},
  nodes: [],
  byId: {},
  galaxies: [],
  galaxyById: {},
  edges: [],
  incoming: {},
  outgoing: {},
  questions: {},
  questionMeta: { pass_threshold: 60 },
  roles: [],
  roleById: {}
};

async function fetchJson(url, label) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${label} 加载失败（HTTP ${res.status}）`);
  return res.json();
}

export async function loadData() {
  const [star, questions, roles] = await Promise.all([
    fetchJson('star-data.json', '星图数据'),
    fetchJson('data/questions.json', '题库'),
    fetchJson('data/roles.json', '方向数据')
  ]);

  Data.meta = star.meta || {};
  Data.nodes = star.nodes || [];
  Data.edges = star.edges || [];
  Data.galaxies = star.galaxies || [];
  Data.byId = {};
  Data.galaxyById = {};
  Data.incoming = {};
  Data.outgoing = {};

  Data.galaxies.forEach(g => { Data.galaxyById[g.id] = g; });
  Data.nodes.forEach(n => {
    Data.byId[n.id] = n;
    Data.incoming[n.id] = [];
    Data.outgoing[n.id] = [];
  });
  Data.edges.forEach(e => {
    if (Data.incoming[e.to]) Data.incoming[e.to].push(e);
    if (Data.outgoing[e.from]) Data.outgoing[e.from].push(e);
  });

  Data.questions = questions.questions || {};
  Data.questionMeta = questions.meta || Data.questionMeta;
  Data.roles = roles.roles || [];
  Data.roleById = {};
  Data.roles.forEach(r => { Data.roleById[r.id] = r; });

  Data.loaded = true;
  return Data;
}

export function nodeById(id) {
  return Data.byId[id];
}

export function galaxyOf(node) {
  return node ? Data.galaxyById[node.galaxy] : null;
}

export function hardPrereqs(id) {
  return (Data.incoming[id] || []).filter(e => e.type === 'prerequisite').map(e => e.from);
}

export function suggestedPrereqs(id) {
  return (Data.incoming[id] || []).filter(e => e.type !== 'prerequisite').map(e => e.from);
}

export function questionsFor(id) {
  return Data.questions[id] || [];
}

export function unlocked(node, lit) {
  if (!node) return false;
  const missingHard = hardPrereqs(node.id).some(id => !lit[id]);
  if (missingHard) return false;
  const any = node.any_of || [];
  return any.length === 0 || any.some(id => lit[id]);
}

export function missingPrereqs(node, lit) {
  return hardPrereqs(node.id).filter(id => !lit[id]);
}

export function galaxyMastery(lit) {
  const result = {};
  Data.galaxies.forEach(g => { result[g.id] = { total: 0, lit: 0, ratio: 0 }; });
  Data.nodes.forEach(n => {
    const bucket = result[n.galaxy];
    if (!bucket) return;
    bucket.total += n.importance;
    if (lit[n.id]) bucket.lit += n.importance;
  });
  Data.galaxies.forEach(g => {
    const b = result[g.id];
    b.ratio = b.total ? b.lit / b.total : 0;
  });
  return result;
}
