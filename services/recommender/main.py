import os
import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
from fastapi import FastAPI, HTTPException, Header, Query
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any

from models import TwoTowerModel, MultiTaskRanker, GRUSeqRecommender
from utils import (
    determine_route,
    evaluate_and_promote,
    load_metadata,
    evaluate_all,
    compute_auc
)

app = FastAPI(
    title="eXplore Recommender Service",
    description="PyTorch-based recommendation engine for matching, ranking, and sequence prediction.",
    version="1.0.0"
)

# Directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHECKPOINT_DIR = os.path.join(BASE_DIR, "checkpoints")
os.makedirs(CHECKPOINT_DIR, exist_ok=True)

# -----------------
# Pydantic Schemas
# -----------------

class CandidateItem(BaseModel):
    item_id: str
    item_features: List[float]

class MatchRequest(BaseModel):
    user_features: List[float]
    candidates: List[CandidateItem]
    num_events: int = Field(..., description="Number of user events used for gating")

class MatchResponseItem(BaseModel):
    item_id: str
    score: float

class MatchResponse(BaseModel):
    route: str
    predictions: List[MatchResponseItem]

class RankCandidate(BaseModel):
    item_id: str
    item_features: List[float]

class RankRequest(BaseModel):
    user_features: List[float]
    candidates: List[RankCandidate]
    num_events: int

class RankResponseItem(BaseModel):
    item_id: str
    open_prob: float
    dwell_prob: float
    save_prob: float
    dislike_prob: float
    combined_score: float

class RankResponse(BaseModel):
    route: str
    predictions: List[RankResponseItem]

class SequenceRequest(BaseModel):
    sequence: List[int] = Field(..., description="Sequence of item IDs (1-based integers)")
    num_events: int
    top_k: int = 5

class SequenceResponseItem(BaseModel):
    item_id: int
    score: float

class SequenceResponse(BaseModel):
    route: str
    predictions: List[SequenceResponseItem]

# Training Schemas
class TrainModelARequest(BaseModel):
    user_features: List[List[float]]
    item_features: List[List[float]]
    labels: List[float]
    epochs: int = 5
    lr: float = 0.01

class TrainModelBRequest(BaseModel):
    user_features: List[List[float]]
    item_features: List[List[float]]
    open_labels: List[float]
    dwell_labels: List[float]
    save_labels: List[float]
    dislike_labels: List[float]
    epochs: int = 5
    lr: float = 0.01

class TrainModelCRequest(BaseModel):
    sequences: List[List[int]]
    targets: List[int]
    num_items: int = 1000
    epochs: int = 5
    lr: float = 0.01

# --------------------------
# Lazy Model Loading Helpers
# --------------------------

def get_model_path(model_name: str) -> str:
    return os.path.join(CHECKPOINT_DIR, f"{model_name}.pt")

def load_trained_model_a(user_dim: int, item_dim: int) -> Optional[TwoTowerModel]:
    metadata = load_metadata()
    active_path = metadata.get("active_model_a")
    if active_path == "baseline" or not active_path:
        return None
    
    path = get_model_path("model_a_active")
    if not os.path.exists(path):
        return None
    
    try:
        checkpoint = torch.load(path, map_location=torch.device("cpu"))
        if isinstance(checkpoint, dict) and "state_dict" in checkpoint:
            saved_user_dim = checkpoint.get("user_dim", user_dim)
            saved_item_dim = checkpoint.get("item_dim", item_dim)
            model = TwoTowerModel(user_dim=saved_user_dim, item_dim=saved_item_dim)
            model.load_state_dict(checkpoint["state_dict"])
        else:
            model = TwoTowerModel(user_dim=user_dim, item_dim=item_dim)
            model.load_state_dict(checkpoint)
        model.eval()
        return model
    except Exception as e:
        print(f"Error loading Model A: {e}")
        return None

def load_trained_model_b(input_dim: int) -> Optional[MultiTaskRanker]:
    metadata = load_metadata()
    active_path = metadata.get("active_model_b")
    if active_path == "baseline" or not active_path:
        return None
    
    path = get_model_path("model_b_active")
    if not os.path.exists(path):
        return None
    
    try:
        checkpoint = torch.load(path, map_location=torch.device("cpu"))
        if isinstance(checkpoint, dict) and "state_dict" in checkpoint:
            saved_input_dim = checkpoint.get("input_dim", input_dim)
            model = MultiTaskRanker(input_dim=saved_input_dim)
            model.load_state_dict(checkpoint["state_dict"])
        else:
            model = MultiTaskRanker(input_dim=input_dim)
            model.load_state_dict(checkpoint)
        model.eval()
        return model
    except Exception as e:
        print(f"Error loading Model B: {e}")
        return None

def load_trained_model_c(num_items: int) -> Optional[GRUSeqRecommender]:
    metadata = load_metadata()
    active_path = metadata.get("active_model_c")
    if active_path == "baseline" or not active_path:
        return None
    
    path = get_model_path("model_c_active")
    if not os.path.exists(path):
        return None
    
    try:
        checkpoint = torch.load(path, map_location=torch.device("cpu"))
        if isinstance(checkpoint, dict) and "state_dict" in checkpoint:
            saved_num_items = checkpoint.get("num_items", num_items)
            model = GRUSeqRecommender(num_items=saved_num_items)
            model.load_state_dict(checkpoint["state_dict"])
        else:
            model = GRUSeqRecommender(num_items=num_items)
            model.load_state_dict(checkpoint)
        model.eval()
        return model
    except Exception as e:
        print(f"Error loading Model C: {e}")
        return None

# -----------------
# Inference Routes
# -----------------

@app.get("/status")
def status():
    """
    Returns active models metadata and gating configuration status.
    """
    metadata = load_metadata()
    return {
        "status": "healthy",
        "device": "cpu",
        "gating_rules": {
            "0-99": "100% baseline",
            "100-499": "20% neural / 80% baseline hybrid",
            "500+": "100% neural"
        },
        "metadata": metadata
    }

@app.post("/inference/match", response_model=MatchResponse)
def match_items(request: MatchRequest):
    route = determine_route(request.num_events)
    user_vec = np.array(request.user_features)
    
    # Check if we should fall back to baseline
    model = None
    if route == "neural":
        user_dim = len(request.user_features)
        item_dim = len(request.candidates[0].item_features) if request.candidates else 0
        if item_dim > 0:
            model = load_trained_model_a(user_dim, item_dim)
            
    if model is None:
        # Baseline / Fallback: cosine similarity (or dot product) of raw user and candidate features
        predictions = []
        for cand in request.candidates:
            cand_vec = np.array(cand.item_features)
            # Dot product
            score = float(np.dot(user_vec, cand_vec))
            predictions.append(MatchResponseItem(item_id=cand.item_id, score=score))
        # Sort predictions descending
        predictions.sort(key=lambda x: x.score, reverse=True)
        return MatchResponse(route=f"baseline_fallback" if route == "neural" else route, predictions=predictions)

    # Neural inference
    try:
        user_t = torch.tensor(request.user_features, dtype=torch.float32)
        cand_t = torch.tensor([c.item_features for c in request.candidates], dtype=torch.float32)
        
        user_emb = model.get_user_embedding(user_t)
        cand_embs = model.get_item_embedding(cand_t)
        
        scores = model.score_candidates(user_emb, cand_embs)
        
        predictions = []
        for i, cand in enumerate(request.candidates):
            predictions.append(MatchResponseItem(item_id=cand.item_id, score=float(scores[i].item())))
            
        predictions.sort(key=lambda x: x.score, reverse=True)
        return MatchResponse(route=route, predictions=predictions)
    except Exception as e:
        # Safe fallback on neural computation failure
        predictions = []
        for cand in request.candidates:
            cand_vec = np.array(cand.item_features)
            score = float(np.dot(user_vec, cand_vec))
            predictions.append(MatchResponseItem(item_id=cand.item_id, score=score))
        predictions.sort(key=lambda x: x.score, reverse=True)
        return MatchResponse(route=f"fallback_error: {str(e)}", predictions=predictions)

@app.post("/inference/rank", response_model=RankResponse)
def rank_items(request: RankRequest):
    route = determine_route(request.num_events)
    
    # Calculate baseline combined score
    # Baseline logic uses simple heuristics: e.g. similarity metric mapped to synthetic probabilities
    user_vec = np.array(request.user_features)
    
    model = None
    if route == "neural" and request.candidates:
        user_dim = len(request.user_features)
        item_dim = len(request.candidates[0].item_features)
        model = load_trained_model_b(user_dim + item_dim)
        
    if model is None:
        predictions = []
        for cand in request.candidates:
            cand_vec = np.array(cand.item_features)
            # Normalize to 0-1 range for synthetic probabilities
            cos_sim = float(np.dot(user_vec, cand_vec) / (np.linalg.norm(user_vec) * np.linalg.norm(cand_vec) + 1e-9))
            prob = 0.5 + 0.4 * cos_sim
            open_prob = max(0.01, min(0.99, prob))
            dwell_prob = max(0.01, min(0.99, prob * 0.9))
            save_prob = max(0.01, min(0.99, prob * 0.4))
            dislike_prob = max(0.01, min(0.99, 1.0 - prob))
            
            # Weighted formula: open + 2*dwell + 3*save - 2*dislike
            combined = open_prob + 2.0 * dwell_prob + 3.0 * save_prob - 2.0 * dislike_prob
            
            predictions.append(RankResponseItem(
                item_id=cand.item_id,
                open_prob=open_prob,
                dwell_prob=dwell_prob,
                save_prob=save_prob,
                dislike_prob=dislike_prob,
                combined_score=combined
            ))
        predictions.sort(key=lambda x: x.combined_score, reverse=True)
        return RankResponse(route=f"baseline_fallback" if route == "neural" else route, predictions=predictions)

    # Neural ranking
    try:
        user_t = torch.tensor(request.user_features, dtype=torch.float32)
        predictions = []
        
        for cand in request.candidates:
            cand_t = torch.tensor(cand.item_features, dtype=torch.float32)
            input_t = torch.cat([user_t, cand_t]).unsqueeze(0) # [1, user_dim + item_dim]
            
            with torch.no_grad():
                probs = model(input_t)
                
            open_p = float(probs["open"].item())
            dwell_p = float(probs["dwell"].item())
            save_p = float(probs["save"].item())
            dislike_p = float(probs["dislike"].item())
            
            # Combine ranking score
            combined = open_p + 2.0 * dwell_p + 3.0 * save_p - 2.0 * dislike_p
            
            predictions.append(RankResponseItem(
                item_id=cand.item_id,
                open_prob=open_p,
                dwell_prob=dwell_p,
                save_prob=save_p,
                dislike_prob=dislike_p,
                combined_score=combined
            ))
            
        predictions.sort(key=lambda x: x.combined_score, reverse=True)
        return RankResponse(route=route, predictions=predictions)
    except Exception as e:
        # Fallback on failure
        predictions = []
        for cand in request.candidates:
            cand_vec = np.array(cand.item_features)
            cos_sim = float(np.dot(user_vec, cand_vec) / (np.linalg.norm(user_vec) * np.linalg.norm(cand_vec) + 1e-9))
            prob = 0.5 + 0.4 * cos_sim
            open_prob = max(0.01, min(0.99, prob))
            dwell_prob = max(0.01, min(0.99, prob * 0.9))
            save_prob = max(0.01, min(0.99, prob * 0.4))
            dislike_prob = max(0.01, min(0.99, 1.0 - prob))
            combined = open_prob + 2.0 * dwell_prob + 3.0 * save_prob - 2.0 * dislike_prob
            
            predictions.append(RankResponseItem(
                item_id=cand.item_id,
                open_prob=open_prob,
                dwell_prob=dwell_prob,
                save_prob=save_prob,
                dislike_prob=dislike_prob,
                combined_score=combined
            ))
        predictions.sort(key=lambda x: x.combined_score, reverse=True)
        return RankResponse(route=f"fallback_error: {str(e)}", predictions=predictions)

@app.post("/inference/sequence", response_model=SequenceResponse)
def predict_sequence(request: SequenceRequest):
    route = determine_route(request.num_events)
    
    # Baseline logic: recommend next indices in vocabulary, or items similar to current sequence
    num_items_fallback = max(request.sequence) + 10 if request.sequence else 100
    
    model = None
    if route == "neural" and request.sequence:
        model = load_trained_model_c(num_items_fallback)
        
    if model is None:
        # Baseline logic: recommend the most recent item index + incremental steps
        predictions = []
        last_item = request.sequence[-1] if request.sequence else 1
        for i in range(1, request.top_k + 1):
            next_suggest = last_item + i
            score = 1.0 / (i + 1)
            predictions.append(SequenceResponseItem(item_id=next_suggest, score=score))
        return SequenceResponse(route=f"baseline_fallback" if route == "neural" else route, predictions=predictions)

    # Neural sequence prediction
    try:
        seq_t = torch.tensor([request.sequence], dtype=torch.long) # [1, seq_len]
        with torch.no_grad():
            logits = model(seq_t).squeeze(0) # [num_items + 1]
            
        # Get top-k items
        scores, indices = torch.topk(logits, k=min(request.top_k, len(logits)))
        
        predictions = []
        for i in range(len(indices)):
            predictions.append(SequenceResponseItem(
                item_id=int(indices[i].item()),
                score=float(scores[i].item())
            ))
        return SequenceResponse(route=route, predictions=predictions)
    except Exception as e:
        # Fallback on failure
        predictions = []
        last_item = request.sequence[-1] if request.sequence else 1
        for i in range(1, request.top_k + 1):
            next_suggest = last_item + i
            score = 1.0 / (i + 1)
            predictions.append(SequenceResponseItem(item_id=next_suggest, score=score))
        return SequenceResponse(route=f"fallback_error: {str(e)}", predictions=predictions)

# -----------------
# Training Routes
# -----------------

@app.post("/train/model_a")
def train_model_a(request: TrainModelARequest):
    """
    Trains Model A (Two-Tower Matcher) on provided data.
    """
    if len(request.user_features) < 10:
        raise HTTPException(status_code=400, detail="Insufficient training data. Need at least 10 sample pairs.")
        
    user_dim = len(request.user_features[0])
    item_dim = len(request.item_features[0])
    
    # Split into train/validation (80/20)
    split_idx = int(len(request.user_features) * 0.8)
    
    user_train = torch.tensor(request.user_features[:split_idx], dtype=torch.float32)
    item_train = torch.tensor(request.item_features[:split_idx], dtype=torch.float32)
    labels_train = torch.tensor(request.labels[:split_idx], dtype=torch.float32)
    
    user_val = torch.tensor(request.user_features[split_idx:], dtype=torch.float32)
    item_val = torch.tensor(request.item_features[split_idx:], dtype=torch.float32)
    labels_val = np.array(request.labels[split_idx:])
    
    model = TwoTowerModel(user_dim=user_dim, item_dim=item_dim)
    optimizer = optim.Adam(model.parameters(), lr=request.lr)
    criterion = nn.BCEWithLogitsLoss()
    
    # Train loop
    model.train()
    for epoch in range(request.epochs):
        optimizer.zero_grad()
        # forward
        outputs = model(user_train, item_train)
        loss = criterion(outputs, labels_train)
        loss.backward()
        optimizer.step()
        
    # Evaluate offline
    model.eval()
    with torch.no_grad():
        val_outputs = model(user_val, item_val).numpy()
        
    metrics = evaluate_all(labels_val, val_outputs, k_list=[5, 10])
    
    # Save temporary checkpoint
    temp_path = get_model_path("model_a_candidate")
    checkpoint = {
        "state_dict": model.state_dict(),
        "user_dim": user_dim,
        "item_dim": item_dim
    }
    torch.save(checkpoint, temp_path)
    
    # Gating / Promotion
    active_path = get_model_path("model_a_active")
    promoted = evaluate_and_promote("model_a", active_path, metrics)
    
    if promoted:
        # Overwrite active checkpoint
        torch.save(checkpoint, active_path)
        
    return {
        "status": "success",
        "loss": float(loss.item()),
        "metrics": metrics,
        "promoted": promoted
    }

@app.post("/train/model_b")
def train_model_b(request: TrainModelBRequest):
    """
    Trains Model B (Multi-Task Ranker MLP) on provided data.
    """
    if len(request.user_features) < 10:
        raise HTTPException(status_code=400, detail="Insufficient training data. Need at least 10 samples.")
        
    user_dim = len(request.user_features[0])
    item_dim = len(request.item_features[0])
    input_dim = user_dim + item_dim
    
    # Combine user and item features
    features = [u + i for u, i in zip(request.user_features, request.item_features)]
    
    split_idx = int(len(features) * 0.8)
    
    feats_train = torch.tensor(features[:split_idx], dtype=torch.float32)
    open_train = torch.tensor(request.open_labels[:split_idx], dtype=torch.float32)
    dwell_train = torch.tensor(request.dwell_labels[:split_idx], dtype=torch.float32)
    save_train = torch.tensor(request.save_labels[:split_idx], dtype=torch.float32)
    dislike_train = torch.tensor(request.dislike_labels[:split_idx], dtype=torch.float32)
    
    feats_val = torch.tensor(features[split_idx:], dtype=torch.float32)
    open_val = np.array(request.open_labels[split_idx:])
    
    model = MultiTaskRanker(input_dim=input_dim)
    optimizer = optim.Adam(model.parameters(), lr=request.lr)
    criterion = nn.BCELoss() # Using BCELoss since head output is Sigmoid
    
    # Train loop
    model.train()
    for epoch in range(request.epochs):
        optimizer.zero_grad()
        probs = model(feats_train)
        
        loss_open = criterion(probs["open"], open_train)
        loss_dwell = criterion(probs["dwell"], dwell_train)
        loss_save = criterion(probs["save"], save_train)
        loss_dislike = criterion(probs["dislike"], dislike_train)
        
        # Combine multi-task loss
        total_loss = loss_open + loss_dwell + loss_save + loss_dislike
        total_loss.backward()
        optimizer.step()
        
    # Evaluate offline (evaluating primary metric: open AUC)
    model.eval()
    with torch.no_grad():
        val_probs = model(feats_val)
        val_open_scores = val_probs["open"].numpy()
        
    # Evaluation metric based on open prediction
    auc_score = compute_auc(open_val, val_open_scores)
    metrics = {"auc": auc_score, "pr_auc": float(np.mean(open_val))}
    
    temp_path = get_model_path("model_b_candidate")
    checkpoint = {
        "state_dict": model.state_dict(),
        "input_dim": input_dim
    }
    torch.save(checkpoint, temp_path)
    
    active_path = get_model_path("model_b_active")
    promoted = evaluate_and_promote("model_b", active_path, metrics)
    
    if promoted:
        torch.save(checkpoint, active_path)
        
    return {
        "status": "success",
        "loss": float(total_loss.item()),
        "metrics": metrics,
        "promoted": promoted
    }

@app.post("/train/model_c")
def train_model_c(request: TrainModelCRequest):
    """
    Trains Model C (Sequential Next-Item Predictor) on provided sequence data.
    """
    if len(request.sequences) < 10:
        raise HTTPException(status_code=400, detail="Insufficient training sequences. Need at least 10 samples.")
        
    # Standardize sequence lengths (pad with 0)
    max_len = max(len(s) for s in request.sequences)
    padded_seqs = []
    for seq in request.sequences:
        if len(seq) < max_len:
            padded_seqs.append([0] * (max_len - len(seq)) + seq)
        else:
            padded_seqs.append(seq[-max_len:])
            
    split_idx = int(len(padded_seqs) * 0.8)
    
    seqs_train = torch.tensor(padded_seqs[:split_idx], dtype=torch.long)
    targets_train = torch.tensor(request.targets[:split_idx], dtype=torch.long)
    
    seqs_val = torch.tensor(padded_seqs[split_idx:], dtype=torch.long)
    targets_val = np.array(request.targets[split_idx:])
    
    model = GRUSeqRecommender(num_items=request.num_items)
    optimizer = optim.Adam(model.parameters(), lr=request.lr)
    criterion = nn.CrossEntropyLoss()
    
    # Train loop
    model.train()
    for epoch in range(request.epochs):
        optimizer.zero_grad()
        logits = model(seqs_train)
        loss = criterion(logits, targets_train)
        loss.backward()
        optimizer.step()
        
    # Evaluate offline
    model.eval()
    with torch.no_grad():
        val_logits = model(seqs_val).numpy()
        
    # For sequence next-item evaluation: NDCG and Recall.
    # Convert targets_val into binary labels per validation sample
    # Here we evaluate if the target index is ranked in the top K.
    recalls = []
    ndcgs = []
    for i, target in enumerate(targets_val):
        y_true = np.zeros(request.num_items + 1)
        y_true[target] = 1.0
        scores = val_logits[i]
        
        # Calculate recall@10
        sorted_idx = np.argsort(scores)[::-1]
        top_10 = sorted_idx[:10]
        hits = 1.0 if target in top_10 else 0.0
        recalls.append(hits)
        
        # Calculate ndcg@10
        if hits > 0.0:
            rank = np.where(top_10 == target)[0][0]
            ndcg = 1.0 / np.log2(rank + 2)
        else:
            ndcg = 0.0
        ndcgs.append(ndcg)
        
    metrics = {
        "recall_at_10": float(np.mean(recalls)),
        "ndcg_at_10": float(np.mean(ndcgs))
    }
    
    temp_path = get_model_path("model_c_candidate")
    checkpoint = {
        "state_dict": model.state_dict(),
        "num_items": request.num_items
    }
    torch.save(checkpoint, temp_path)
    
    active_path = get_model_path("model_c_active")
    promoted = evaluate_and_promote("model_c", active_path, metrics)
    
    if promoted:
        torch.save(checkpoint, active_path)
        
    return {
        "status": "success",
        "loss": float(loss.item()),
        "metrics": metrics,
        "promoted": promoted
    }
