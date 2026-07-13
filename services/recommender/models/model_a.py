import torch
import torch.nn as nn
import torch.nn.functional as F

class TowerModel(nn.Module):
    def __init__(self, input_dim: int, hidden_dims: list, output_dim: int):
        super().__init__()
        layers = []
        prev_dim = input_dim
        for dim in hidden_dims:
            layers.append(nn.Linear(prev_dim, dim))
            # Use LayerNorm instead of BatchNorm to be robust to batch size of 1
            layers.append(nn.LayerNorm(dim))
            layers.append(nn.ReLU())
            layers.append(nn.Dropout(0.1))
            prev_dim = dim
        layers.append(nn.Linear(prev_dim, output_dim))
        self.network = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.network(x)
        return F.normalize(out, p=2, dim=-1)

class TwoTowerModel(nn.Module):
    def __init__(self, user_dim: int, item_dim: int, hidden_dims: list = [128, 64], latent_dim: int = 32):
        super().__init__()
        self.user_tower = TowerModel(user_dim, hidden_dims, latent_dim)
        self.item_tower = TowerModel(item_dim, hidden_dims, latent_dim)

    def forward(self, user_features: torch.Tensor, item_features: torch.Tensor) -> torch.Tensor:
        """
        Compute similarity score between user and item features.
        Assumes batch alignment.
        """
        user_emb = self.user_tower(user_features)
        item_emb = self.item_tower(item_features)
        # Cosine similarity since towers return normalized vectors
        similarity = torch.sum(user_emb * item_emb, dim=-1)
        return similarity

    def get_user_embedding(self, user_features: torch.Tensor) -> torch.Tensor:
        self.eval()
        with torch.no_grad():
            return self.user_tower(user_features)

    def get_item_embedding(self, item_features: torch.Tensor) -> torch.Tensor:
        self.eval()
        with torch.no_grad():
            return self.item_tower(item_features)

    def score_candidates(self, user_emb: torch.Tensor, item_embs: torch.Tensor) -> torch.Tensor:
        """
        Compute similarity between a single user embedding [latent_dim] or [1, latent_dim]
        and multiple candidate item embeddings [num_candidates, latent_dim].
        """
        if user_emb.dim() == 1:
            user_emb = user_emb.unsqueeze(0) # [1, latent_dim]
        # Cosine similarity
        scores = torch.mm(user_emb, item_embs.t()) # [1, num_candidates]
        return scores.squeeze(0)
