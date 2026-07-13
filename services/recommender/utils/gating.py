import json
import os
import random

METADATA_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "model_metadata.json")

DEFAULT_METADATA = {
    "active_model_a": "baseline",
    "active_model_b": "baseline",
    "active_model_c": "baseline",
    "metrics_a": {"auc": 0.5, "ndcg_at_10": 0.0},
    "metrics_b": {"auc": 0.5, "pr_auc": 0.0},
    "metrics_c": {"recall_at_10": 0.0, "ndcg_at_10": 0.0},
    "promotion_threshold_pct": 1.0  # 1.0% relative improvement required to promote
}

def load_metadata() -> dict:
    if not os.path.exists(METADATA_PATH):
        save_metadata(DEFAULT_METADATA)
        return DEFAULT_METADATA
    try:
        with open(METADATA_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return DEFAULT_METADATA

def save_metadata(metadata: dict):
    os.makedirs(os.path.dirname(METADATA_PATH), exist_ok=True)
    with open(METADATA_PATH, "w") as f:
        json.dump(metadata, f, indent=4)

def determine_route(num_events: int) -> str:
    """
    Returns the routing decision:
    - 'baseline': run baseline/fallback logic (0-99 events or random 80% for 100-499)
    - 'neural': run neural model logic (random 20% for 100-499 or 100% for >= 500)
    """
    if num_events < 100:
        return "baseline"
    elif num_events < 500:
        # 100-499: 20% neural, 80% baseline
        return "neural" if random.random() < 0.20 else "baseline"
    else:
        # >= 500: 100% neural
        return "neural"

def evaluate_and_promote(model_type: str, new_model_path: str, new_metrics: dict) -> bool:
    """
    Evaluates new model metrics against the active model metrics.
    If the relative improvement in the primary metric is >= threshold, promotes the model.
    Primary metrics:
    - Model A: ndcg_at_10
    - Model B: auc
    - Model C: ndcg_at_10
    """
    metadata = load_metadata()
    threshold_pct = metadata.get("promotion_threshold_pct", 1.0)
    
    # Identify primary metric and keys
    if model_type == "model_a":
        primary_metric = "ndcg_at_10"
        active_metrics = metadata.get("metrics_a", {})
        active_model_key = "active_model_a"
        metrics_key = "metrics_a"
    elif model_type == "model_b":
        primary_metric = "auc"
        active_metrics = metadata.get("metrics_b", {})
        active_model_key = "active_model_b"
        metrics_key = "metrics_b"
    elif model_type == "model_c":
        primary_metric = "ndcg_at_10"
        active_metrics = metadata.get("metrics_c", {})
        active_model_key = "active_model_c"
        metrics_key = "metrics_c"
    else:
        raise ValueError(f"Unknown model type: {model_type}")

    active_val = active_metrics.get(primary_metric, 0.0)
    new_val = new_metrics.get(primary_metric, 0.0)
    
    promoted = False
    if active_val <= 0.0:
        # If there's no active model score, promote any new model with a positive metric score
        if new_val > 0.0:
            promoted = True
    else:
        # Compute relative improvement percentage
        improvement = ((new_val - active_val) / active_val) * 100.0
        if improvement >= threshold_pct:
            promoted = True

    if promoted:
        metadata[active_model_key] = new_model_path
        metadata[metrics_key] = new_metrics
        save_metadata(metadata)
        
    return promoted
