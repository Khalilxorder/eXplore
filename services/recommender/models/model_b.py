import torch
import torch.nn as nn

class MultiTaskRanker(nn.Module):
    def __init__(self, input_dim: int, shared_hidden_dims: list = [128, 64]):
        super().__init__()
        # Shared MLP Base
        layers = []
        prev_dim = input_dim
        for dim in shared_hidden_dims:
            layers.append(nn.Linear(prev_dim, dim))
            layers.append(nn.LayerNorm(dim))
            layers.append(nn.ReLU())
            layers.append(nn.Dropout(0.1))
            prev_dim = dim
        self.shared_base = nn.Sequential(*layers)

        # Task Heads (Open, Dwell, Save, Dislike)
        self.open_head = nn.Sequential(nn.Linear(prev_dim, 1), nn.Sigmoid())
        self.dwell_head = nn.Sequential(nn.Linear(prev_dim, 1), nn.Sigmoid())
        self.save_head = nn.Sequential(nn.Linear(prev_dim, 1), nn.Sigmoid())
        self.dislike_head = nn.Sequential(nn.Linear(prev_dim, 1), nn.Sigmoid())

    def forward(self, x: torch.Tensor) -> dict:
        """
        Forward pass.
        Returns a dictionary containing predicted probabilities for:
        - open
        - dwell
        - save
        - dislike
        """
        shared_features = self.shared_base(x)
        return {
            "open": self.open_head(shared_features).squeeze(-1),
            "dwell": self.dwell_head(shared_features).squeeze(-1),
            "save": self.save_head(shared_features).squeeze(-1),
            "dislike": self.dislike_head(shared_features).squeeze(-1)
        }
