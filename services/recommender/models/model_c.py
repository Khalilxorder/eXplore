import torch
import torch.nn as nn

class GRUSeqRecommender(nn.Module):
    def __init__(self, num_items: int, embedding_dim: int = 64, hidden_dim: int = 128, num_layers: int = 1):
        super().__init__()
        self.num_items = num_items
        # We add 1 to the vocab size to account for padding (index 0)
        self.item_embeddings = nn.Embedding(num_items + 1, embedding_dim, padding_idx=0)
        self.gru = nn.GRU(
            input_size=embedding_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True
        )
        self.fc = nn.Linear(hidden_dim, num_items + 1)
        self.dropout = nn.Dropout(0.1)

    def forward(self, seq_item_ids: torch.Tensor) -> torch.Tensor:
        """
        Input: Tensor of shape [batch_size, seq_len] of item IDs.
        Output: Logits over the item vocabulary [batch_size, num_items + 1].
        """
        # Embed sequence: [batch_size, seq_len, embedding_dim]
        embeddings = self.item_embeddings(seq_item_ids)
        embeddings = self.dropout(embeddings)
        
        # Pass through GRU: out shape [batch_size, seq_len, hidden_dim]
        out, _ = self.gru(embeddings)
        
        # Extract the last hidden state of the sequence for prediction
        last_out = out[:, -1, :]
        last_out = self.dropout(last_out)
        
        # Predict logits over items: [batch_size, num_items + 1]
        logits = self.fc(last_out)
        return logits
