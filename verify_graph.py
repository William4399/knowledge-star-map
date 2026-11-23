"""校验星图数据：节点/边完整性、星系归属、any_of 引用、prerequisite 无环。"""
import json
from collections import defaultdict, deque

with open("star-data.json", encoding="utf-8") as f:
    data = json.load(f)

nodes = data["nodes"]
edges = data["edges"]
galaxies = data["galaxies"]

ids = {n["id"] for n in nodes}
galaxy_ids = {g["id"] for g in galaxies}

print(f"星系 {len(galaxies)} 个 / 节点 {len(nodes)} 个 / 边 {len(edges)} 条")

errors = []

# 1. 边引用
for e in edges:
    if e["from"] not in ids or e["to"] not in ids:
        errors.append(f"边指向不存在的节点: {e}")

# 2. 星系归属
for n in nodes:
    if n.get("galaxy") not in galaxy_ids:
        errors.append(f"节点 {n['id']} 的星系 {n.get('galaxy')} 不存在")
    for key in ("importance", "complexity"):
        v = n.get(key)
        if not isinstance(v, int) or not 1 <= v <= 5:
            errors.append(f"节点 {n['id']} 的 {key} 非法: {v}")

# 3. any_of 引用
for n in nodes:
    for ref in n.get("any_of", []):
        if ref not in ids:
            errors.append(f"节点 {n['id']} 的 any_of 引用了不存在的 {ref}")

# 4. 星系人数统计
cnt = defaultdict(int)
for n in nodes:
    cnt[n["galaxy"]] += 1
print("星系节点数:", dict(cnt))

# 5. prerequisite 拓扑排序
adj = defaultdict(list)
in_deg = {nid: 0 for nid in ids}
for e in edges:
    if e["type"] == "prerequisite":
        adj[e["from"]].append(e["to"])
        in_deg[e["to"]] += 1

queue = deque([nid for nid in ids if in_deg[nid] == 0])
visited = []
while queue:
    cur = queue.popleft()
    visited.append(cur)
    for nxt in adj[cur]:
        in_deg[nxt] -= 1
        if in_deg[nxt] == 0:
            queue.append(nxt)

if len(visited) != len(ids):
    errors.append(f"prerequisite 存在环，卡住: {ids - set(visited)}")

# 6. 起点
starts = [n["id"] for n in nodes
          if not any(e["to"] == n["id"] and e["type"] == "prerequisite" for e in edges)
          and not n.get("any_of")]
print("起点节点:", starts)

# 7. 用户最初可能已掌握的节点数
print("重要度 5 的星:", [n["name"] for n in nodes if n["importance"] == 5])

if errors:
    print("\n❌ 发现问题:")
    for e in errors:
        print("  -", e)
else:
    print("\n✓ 全部校验通过")
