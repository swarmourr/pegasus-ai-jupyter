#!/usr/bin/env python3
"""
Evaluate all trained models, select the best one, and generate predictions.
"""
import argparse
import sys
import json
import pickle
import os

def main():
    parser = argparse.ArgumentParser(description="Evaluate and select best model")
    parser.add_argument("--test_x", required=True, help="Test features CSV")
    parser.add_argument("--test_y", required=True, help="Test target CSV")
    parser.add_argument("--model_lr", required=True, help="Linear Regression model pickle")
    parser.add_argument("--model_rf", required=True, help="Random Forest model pickle")
    parser.add_argument("--model_gb", required=True, help="Gradient Boosting model pickle")
    parser.add_argument("--metrics_lr", required=True, help="LR metrics JSON")
    parser.add_argument("--metrics_rf", required=True, help="RF metrics JSON")
    parser.add_argument("--metrics_gb", required=True, help="GB metrics JSON")
    parser.add_argument("--output_report", required=True, help="Output evaluation report")
    parser.add_argument("--output_best_model", required=True, help="Output best model pickle")
    parser.add_argument("--output_predictions", required=True, help="Output predictions CSV")
    parser.add_argument("--random_state", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    try:
        import pandas as pd
        import numpy as np
        from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
    except ImportError as e:
        print(f"ERROR: Missing required library: {e}", file=sys.stderr)
        sys.exit(1)

    # Load test data
    X_test = pd.read_csv(args.test_x).values
    y_test = pd.read_csv(args.test_y).values.ravel()
    
    # Load models and their training metrics
    models = {}
    metrics = {}
    
    for model_type, model_path, metrics_path in [
        ("Linear Regression", args.model_lr, args.metrics_lr),
        ("Random Forest", args.model_rf, args.metrics_rf),
        ("Gradient Boosting", args.model_gb, args.metrics_gb),
    ]:
        with open(model_path, "rb") as f:
            models[model_type] = pickle.load(f)
        with open(metrics_path, "r") as f:
            metrics[model_type] = json.load(f)
    
    # Evaluate each model on test set
    results = []
    for model_type, model in models.items():
        y_pred = model.predict(X_test)
        rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
        mae = float(mean_absolute_error(y_test, y_pred))
        r2 = float(r2_score(y_test, y_pred))
        
        results.append({
            "model": model_type,
            "test_rmse": round(rmse, 4),
            "test_mae": round(mae, 4),
            "test_r2": round(r2, 4),
            "train_r2": metrics[model_type]["train_r2"]
        })
    
    # Select best model based on test R²
    results.sort(key=lambda x: x["test_r2"], reverse=True)
    best = results[0]
    
    # Write evaluation report
    report_lines = []
    report_lines.append("=" * 70)
    report_lines.append("MODEL EVALUATION REPORT - Real Estate Price Prediction")
    report_lines.append("=" * 70)
    report_lines.append(f"\nTest set size: {X_test.shape[0]} samples")
    report_lines.append(f"Feature count: {X_test.shape[1]}")
    report_lines.append("\n" + "-" * 70)
    report_lines.append("MODEL COMPARISON")
    report_lines.append("-" * 70)
    
    header = f"{'Model':<22} {'Test RMSE':<12} {'Test MAE':<12} {'Test R²':<10} {'Train R²':<10}"
    report_lines.append("\n" + header)
    report_lines.append("-" * len(header))
    
    for r in results:
        report_lines.append(
            f"{r['model']:<22} {r['test_rmse']:<12} {r['test_mae']:<12} {r['test_r2']:<10} {r['train_r2']:<10}"
        )
    
    report_lines.append("\n" + "-" * 70)
    report_lines.append(f"BEST MODEL: {best['model']} (Test R² = {best['test_r2']})")
    report_lines.append("-" * 70)
    
    report_lines.append("\n" + "=" * 70)
    report_lines.append("FEATURE IMPORTANCE (if available)")
    report_lines.append("=" * 70)
    
    best_model = models[best["model"]]
    if hasattr(best_model, "feature_importances_"):
        feature_names = pd.read_csv(args.test_x).columns.tolist()
        importances = best_model.feature_importances_
        sorted_idx = np.argsort(importances)[::-1]
        report_lines.append(f"\n{'Feature':<40} {'Importance':<10}")
        report_lines.append("-" * 50)
        for idx in sorted_idx:
            report_lines.append(f"{feature_names[idx]:<40} {importances[idx]:<10.4f}")
    elif hasattr(best_model, "coef_"):
        feature_names = pd.read_csv(args.test_x).columns.tolist()
        coefs = best_model.coef_
        report_lines.append(f"\n{'Feature':<40} {'Coefficient':<10}")
        report_lines.append("-" * 50)
        for name, coef in zip(feature_names, coefs):
            report_lines.append(f"{name:<40} {coef:<10.4f}")
    
    with open(args.output_report, "w") as f:
        f.write("\n".join(report_lines))
    print(f"[Evaluate] Report written to {args.output_report}")
    
    # Save best model
    with open(args.output_best_model, "wb") as f:
        pickle.dump(best_model, f)
    print(f"[Evaluate] Best model ({best['model']}) saved to {args.output_best_model}")
    
    # Generate predictions on test set
    y_pred_best = best_model.predict(X_test)
    pred_df = pd.DataFrame({
        "actual": y_test,
        "predicted": np.round(y_pred_best, 4),
        "residual": np.round(y_test - y_pred_best, 4)
    })
    pred_df.to_csv(args.output_predictions, index=False)
    print(f"[Evaluate] Predictions saved to {args.output_predictions}")
    
    print("[Evaluate] Complete!")


if __name__ == "__main__":
    main()
