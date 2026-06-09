#!/usr/bin/env python3
"""
Train a regression model on the Real Estate dataset.
Supports: linear_regression, random_forest, gradient_boosting
"""
import argparse
import sys
import pickle
import json

def main():
    parser = argparse.ArgumentParser(description="Train regression model")
    parser.add_argument("--train_x", required=True, help="Training features CSV")
    parser.add_argument("--train_y", required=True, help="Training target CSV")
    parser.add_argument("--model_type", required=True,
                        choices=["linear_regression", "random_forest", "gradient_boosting"],
                        help="Type of model to train")
    parser.add_argument("--output_model", required=True, help="Output model pickle file")
    parser.add_argument("--output_metrics", required=True, help="Output training metrics JSON")
    parser.add_argument("--random_state", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    try:
        import pandas as pd
        import numpy as np
        from sklearn.linear_model import LinearRegression
        from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
        from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
    except ImportError as e:
        print(f"ERROR: Missing required library: {e}", file=sys.stderr)
        sys.exit(1)

    # Load data
    X_train = pd.read_csv(args.train_x).values
    y_train = pd.read_csv(args.train_y).values.ravel()
    
    print(f"[Train-{args.model_type}] Training samples: {X_train.shape[0]}, Features: {X_train.shape[1]}")
    
    # Initialize model
    if args.model_type == "linear_regression":
        model = LinearRegression()
    elif args.model_type == "random_forest":
        model = RandomForestRegressor(
            n_estimators=200, max_depth=15, random_state=args.random_state, n_jobs=-1
        )
    elif args.model_type == "gradient_boosting":
        model = GradientBoostingRegressor(
            n_estimators=200, max_depth=5, learning_rate=0.1, random_state=args.random_state
        )
    
    # Train
    model.fit(X_train, y_train)
    
    # Evaluate on training set
    y_pred = model.predict(X_train)
    rmse = float(np.sqrt(mean_squared_error(y_train, y_pred)))
    mae = float(mean_absolute_error(y_train, y_pred))
    r2 = float(r2_score(y_train, y_pred))
    
    metrics = {
        "model_type": args.model_type,
        "train_rmse": round(rmse, 4),
        "train_mae": round(mae, 4),
        "train_r2": round(r2, 4),
        "n_features": X_train.shape[1],
        "n_samples": X_train.shape[0]
    }
    
    # Save model
    with open(args.output_model, "wb") as f:
        pickle.dump(model, f)
    
    # Save metrics
    with open(args.output_metrics, "w") as f:
        json.dump(metrics, f, indent=2)
    
    print(f"[Train-{args.model_type}] RMSE: {rmse:.4f}, MAE: {mae:.4f}, R²: {r2:.4f}")
    print(f"[Train-{args.model_type}] Model saved to {args.output_model}")
    print(f"[Train-{args.model_type}] Metrics saved to {args.output_metrics}")
    print(f"[Train-{args.model_type}] Complete!")


if __name__ == "__main__":
    main()
