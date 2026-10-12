import pytest

from app.evaluation import metrics as m


def test_precision_at_k():
    assert m.precision_at_k([True, False, True, False], 4) == 0.5
    assert m.precision_at_k([True, False, True, False], 2) == 0.5
    assert m.precision_at_k([], 0) == 0.0


def test_recall_at_k_counts_distinct_documents():
    retrieved = ["a", "a", "c", "b"]
    assert m.recall_at_k(retrieved, {"a", "b"}, 4) == 1.0
    assert m.recall_at_k(retrieved, {"a", "b"}, 3) == 0.5
    assert m.recall_at_k(retrieved, set(), 3) == 0.0


def test_reciprocal_rank_and_hit_rate():
    assert m.reciprocal_rank([False, False, True]) == pytest.approx(1 / 3)
    assert m.reciprocal_rank([False, False]) == 0.0
    assert m.hit_rate([False, True]) == 1.0
    assert m.hit_rate([False, False]) == 0.0


def test_ndcg_perfect_and_imperfect_rankings():
    assert m.ndcg_at_k([True, True, False], 3, total_relevant=2) == pytest.approx(1.0)
    assert m.ndcg_at_k([False, True, True], 3, total_relevant=2) < 1.0
    assert m.ndcg_at_k([False, False], 2, total_relevant=0) == 0.0


def test_context_precision_rewards_early_relevance():
    early = m.context_precision([True, False, False])
    late = m.context_precision([False, False, True])
    assert early == 1.0
    assert late == pytest.approx(1 / 3)
    assert m.context_precision([False, False]) == 0.0


def test_token_f1():
    assert m.token_f1("The Pro plan costs $49 per month", "Pro costs $49 per month") > 0.8
    assert m.token_f1("completely unrelated words", "Pro costs $49") == 0.0
    assert m.token_f1("", "anything") == 0.0


def test_statement_support():
    contexts = ["Snapshots are kept for 35 days on the Pro plan."]
    assert m.statement_support(["Pro snapshots are kept 35 days."], contexts) == 1.0
    assert m.statement_support(["Enterprise customers get phone support."], contexts) == 0.0
    assert m.statement_support(["anything"], []) == 0.0


def test_faithfulness_treats_abstention_as_faithful():
    assert m.heuristic_faithfulness("I don't know.", ["ctx"], abstained=True) == 1.0
    assert m.heuristic_answer_relevancy("q?", "I don't know.", 0.9, abstained=True) == 0.0


def test_quality_index_is_weighted_and_skips_missing():
    perfect = {k: 1.0 for k in m.QUALITY_WEIGHTS}
    assert m.quality_index(perfect) == 100.0
    partial = {"faithfulness": 0.5}
    assert m.quality_index(partial) == 50.0
    assert m.quality_index({}) is None


def test_percentile_interpolates():
    assert m.percentile([1, 2, 3, 4], 50) == 2.5
    assert m.percentile([10], 95) == 10
    assert m.percentile([], 50) is None
