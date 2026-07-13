# eXplore Neural Recommender Service

This service is a FastAPI-based deep learning recommender system. It implements three PyTorch models for personalized matching, multi-task ranking, and sequential next-item recommendation.

## Directory Structure
- `models/`: PyTorch model architectures (Model A, B, C)
- `utils/`: Metrics evaluation (Recall@K, NDCG@K, AUC, PR-AUC) and model gating logic
- `main.py`: FastAPI application routing training and inference endpoints

## PyTorch Models
1. **Model A (Two-Tower Matcher)**: Projects user profile vectors and item content embeddings into a shared latent space to compute similarity scores.
2. **Model B (Multi-Task Ranker MLP)**: A multi-task multi-layer perceptron that shares lower layers and predicts four distinct probability heads: open, dwell, save, and dislike.
3. **Model C (Sequential Next-Item Predictor)**: A GRU-based recurrent neural network that consumes interaction sequences to predict the next relevant item.

## Model Gating & Promotion Logic
- **Traffic Routing**:
  - `0 - 99` user events: 100% baseline heuristic (fallback/random/popularity).
  - `100 - 499` user events: Hybrid mode (80% baseline, 20% neural exploration).
  - `>= 500` user events: 100% neural service.
- **Model Promotion Criteria**: A trained model is evaluated offline. It is promoted only if its metric improvements (e.g., AUC or NDCG) exceed the active model or baseline metrics by at least a predefined threshold (e.g., $+1.0\%$ relative improvement).

## Running the Service

### Locally with Python
1. Install dependencies:
   ```bash
   pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
   ```
2. Start the service:
   ```bash
   uvicorn main:app --host 127.0.0.1 --port 8000 --reload
   ```

### Docker
1. Build the image:
   ```bash
   docker build -t explore-recommender .
   ```
2. Run the container:
   ```bash
   docker run -p 8000:8000 explore-recommender
   ```
