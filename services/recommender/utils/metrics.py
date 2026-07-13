import numpy as np
from sklearn.metrics import roc_auc_score, precision_recall_curve, auc

def compute_auc(y_true: np.ndarray, y_score: np.ndarray) -> float:
    """
    Compute Area Under the Receiver Operating Characteristic Curve (ROC AUC).
    Returns 0.5 fallback if less than two classes are present.
    """
    y_true = np.asarray(y_true)
    y_score = np.asarray(y_score)
    if len(np.unique(y_true)) < 2:
        return 0.5
    try:
        return float(roc_auc_score(y_true, y_score))
    except Exception:
        return 0.5

def compute_pr_auc(y_true: np.ndarray, y_score: np.ndarray) -> float:
    """
    Compute Area Under the Precision-Recall Curve (PR AUC / Average Precision).
    """
    y_true = np.asarray(y_true)
    y_score = np.asarray(y_score)
    if len(np.unique(y_true)) < 2:
        return float(np.mean(y_true)) if len(y_true) > 0 else 0.0
    try:
        precision, recall, _ = precision_recall_curve(y_true, y_score)
        return float(auc(recall, precision))
    except Exception:
        return 0.0

def compute_recall_at_k(y_true: np.ndarray, y_score: np.ndarray, k: int = 10) -> float:
    """
    Compute Recall@K.
    y_true: binary labels (1 for active interaction, 0 otherwise)
    y_score: predicted scores or probabilities
    k: top K cutoff
    """
    y_true = np.asarray(y_true)
    y_score = np.asarray(y_score)
    if len(y_true) == 0 or np.sum(y_true) == 0:
        return 0.0
    
    # Sort indices by score descending
    sorted_indices = np.argsort(y_score)[::-1]
    top_k_indices = sorted_indices[:k]
    
    # Hits in top K
    hits = np.sum(y_true[top_k_indices])
    total_positives = np.sum(y_true)
    
    return float(hits / total_positives)

def compute_ndcg_at_k(y_true: np.ndarray, y_score: np.ndarray, k: int = 10) -> float:
    """
    Compute Normalized Discounted Cumulative Gain at K (NDCG@K).
    """
    y_true = np.asarray(y_true)
    y_score = np.asarray(y_score)
    if len(y_true) == 0 or np.sum(y_true) == 0:
        return 0.0
    
    # Sort indices by score descending
    sorted_indices = np.argsort(y_score)[::-1]
    top_k_indices = sorted_indices[:k]
    
    # Relevance scores in sorted order
    relevance = y_true[top_k_indices]
    
    # Compute DCG@K
    discount = np.log2(np.arange(2, len(relevance) + 2))
    dcg = np.sum(relevance / discount)
    
    # Compute IDCG@K (Ideal DCG)
    ideal_relevance = np.sort(y_true)[::-1][:k]
    ideal_discount = np.log2(np.arange(2, len(ideal_relevance) + 2))
    idcg = np.sum(ideal_relevance / ideal_discount)
    
    if idcg == 0.0:
        return 0.0
    
    return float(dcg / idcg)

def evaluate_all(y_true: np.ndarray, y_score: np.ndarray, k_list: list = [5, 10]) -> dict:
    """
    Evaluate all metrics (AUC, PR-AUC, Recall@K, NDCG@K) for list of K values.
    """
    y_true = np.asarray(y_true)
    y_score = np.asarray(y_score)
    metrics = {
        "auc": compute_auc(y_true, y_score),
        "pr_auc": compute_pr_auc(y_true, y_score)
    }
    for k in k_list:
        metrics[f"recall_at_{k}"] = compute_recall_at_k(y_true, y_score, k)
        metrics[f"ndcg_at_{k}"] = compute_ndcg_at_k(y_true, y_score, k)
    return metrics
