#!/usr/bin/env python3
"""
Data preprocessing for Real Estate dataset.
Splits data into train/test sets and scales features.
"""
import argparse
import sys
import os
import pickle

def main():
    parser = argparse.ArgumentParser(description="Preprocess Real Estate data")
    parser.add_argument("--input", required=True, help="Input CSV file")
    parser.add_argument("--output_train_x", required=True, help="Output training features CSV")
    parser.add_argument("--output_train_y", required=True, help="Output training target CSV")
    parser.add_argument("--output_test_x", required=True, help="Output test features CSV")
    parser.add_argument("--output_test_y", required=True, help="Output test target CSV")
    parser.add_argument("--output_scaler", required=True, help="Output scaler pickle file")
    parser.add_argument("--test_size", type=float, default=0.2, help="Test set proportion")
    parser.add_argument("--random_state", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    try:
        import pandas as pd
        import numpy as np
        from sklearn.model_selection import train_test_split
        from sklearn.preprocessing import StandardScaler
    except ImportError as e:
        print(f"ERROR: Missing required library: {e}", file=sys.stderr)
        sys.exit(1)

    # Read data
    df = pd.read_csv(args.input)
    df.columns = df.columns.str.strip()
    
    # Identify target and features
    target_col = [c for c in df.columns if "price" in c.lower() or c == "Y house price of unit area"][0]
    feature_cols = [c for c in df.columns if c not in ["No", target_col]]
    
    X = df[feature_cols].values
    y = df[target_col].values
    
    print(f"[Preprocess] Features ({len(feature_cols)}): {feature_cols}")
    print(f"[Preprocess] Samples: {X.shape[0]}")
    
    # Split into train/test
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=args.test_size, random_state=args.random_state
    )
    print(f"[Preprocess] Train: {X_train.shape[0]}, Test: {X_test.shape[0]}")
    
    # Scale features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Save as CSV
    train_df = pd.DataFrame(X_train_scaled, columns=feature_cols)
    train_df.to_csv(args.output_train_x, index=False)
    
    pd.Series(y_train, name=target_col).to_csv(args.output_train_y, index=False)
    
    test_df = pd.DataFrame(X_test_scaled, columns=feature_cols)
    test_df.to_csv(args.output_test_x, index=False)
    
    pd.Series(y_test, name=target_col).to_csv(args.output_test_y, index=False)
    
    # Save scaler
    with open(args.output_scaler, "wb") as f:
        pickle.dump(scaler, f)
    
    print(f"[Preprocess] Training features: {args.output_train_x}")
    print(f"[Preprocess] Training target:   {args.output_train_y}")
    print(f"[Preprocess] Test features:     {args.output_test_x}")
    print(f"[Preprocess] Test target:       {args.output_test_y}")
    print(f"[Preprocess] Scaler:            {args.output_scaler}")
    print("[Preprocess] Complete!")


if __name__ == "__main__":
    main()
