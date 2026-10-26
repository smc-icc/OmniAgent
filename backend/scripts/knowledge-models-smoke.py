"""Synthetic, bounded CPU model + FreeToken checks, run inside the RAGFlow container."""
import json
import math
import time
import urllib.request
import urllib.error

checks = []
timings = {}


def post(label, url, body):
    start = time.monotonic()
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as response:
        result = json.load(response)
    timings[label] = round(time.monotonic() - start, 3)
    return result


texts = ["测试知识：退款申请需要提供订单编号。", "测试知识：今天的天气晴朗。", "测试知识：设备故障请先检查电源。"]
vectors = post("embedding", "http://knowledge-embedding:80/embed", {"inputs": texts})
assert len(vectors) == len(texts)
assert all(len(v) == 512 and all(math.isfinite(x) for x in v) for v in vectors)
assert all(abs(sum(x * x for x in v) - 1) < 0.01 for v in vectors)
assert vectors[0] != vectors[1]
checks += ["embedding-batch-512-finite", "embedding-normalized-distinct"]
query = "申请退款需要提供什么？"
q = post("query-embedding", "http://knowledge-embedding:80/embed", {"inputs": query})[0]
scores = [sum(a * b for a, b in zip(q, v)) for v in vectors]
assert scores.index(max(scores)) == 0
checks.append("embedding-semantic-match")
ranked = post("reranker", "http://knowledge-reranker:80/rerank", {"query": query, "texts": texts, "raw_scores": False, "truncate": False})
assert len(ranked) == len(texts) and sorted(r["index"] for r in ranked) == list(range(len(texts)))
assert all(math.isfinite(r["score"]) and 0 <= r["score"] <= 1 for r in ranked)
assert max(ranked, key=lambda r: r["score"])["index"] == 0
checks += ["reranker-complete-finite-scores", "reranker-relevant-first"]
# Match the existing RAGFlow worker's embedding batch and HuggingFace rerank batch.
batch = post("embedding-batch16", "http://knowledge-embedding:80/embed", {"inputs": [texts[i % 3] for i in range(16)]})
assert len(batch) == 16 and all(len(v) == 512 for v in batch)
batch_rank = post("reranker-batch8", "http://knowledge-reranker:80/rerank", {"query": query, "texts": [texts[i % 3] for i in range(8)], "raw_scores": False, "truncate": False})
assert sorted(r["index"] for r in batch_rank) == list(range(8))
checks.append("ragflow-batch16-and-batch8")
long_vectors = post("embedding-long", "http://knowledge-embedding:80/embed", {"inputs": "测试资料。" * 1000})
assert len(long_vectors[0]) == 512
try:
    post("reranker-long", "http://knowledge-reranker:80/rerank", {"query": query, "texts": ["测试资料。" * 1000], "truncate": False})
    raise AssertionError("Reranker silently accepted an oversized untruncated request")
except urllib.error.HTTPError as error:
    assert error.code in (400, 413, 422)
checks.append("input-length-boundaries")
chat = post("chat", "http://host.docker.internal:1919/v1/chat/completions", {
    "model": "gpt-oss-20b", "messages": [{"role": "user", "content": "根据资料回答，勿补充资料外信息。资料：" + texts[0] + " 问题：" + query}],
    "reasoning_effort": "low", "max_tokens": 256, "stream": False,
})
answer = chat["choices"][0]["message"]["content"]
assert answer and "订单" in answer and "编号" in answer
checks.append("freetoken-grounded-synthetic-answer")
print(json.dumps({"status": "models_smoke_passed", "checks": checks, "dimensions": 512, "seconds": timings}, ensure_ascii=False))
