#!/usr/bin/env python3
"""
Exploratory Data Analysis for Real Estate dataset.
Generates summary statistics, histograms, and correlation analysis.
"""
import argparse
import sys
import os

def main():
    parser = argparse.ArgumentParser(description="EDA for Real Estate dataset")
    parser.add_argument("--input", required=True, help="Input CSV file (Real estate.csv)")
    parser.add_argument("--output_report", required=True, help="Output text file for EDA report")
    parser.add_argument("--output_histogram", required=True, help="Output histogram PNG")
    parser.add_argument("--output_corr", required=True, help="Output correlation matrix PNG")
    args = parser.parse_args()

    try:
        import pandas as pd
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import seaborn as sns
        import numpy as np
    except ImportError as e:
        print(f"ERROR: Missing required library: {e}", file=sys.stderr)
        sys.exit(1)

    # Read data
    df = pd.read_csv(args.input)
    
    # Clean column names: strip whitespace
    df.columns = df.columns.str.strip()
    
    # Identify target column (contains "house price" or "Y house price")
    target_col = [c for c in df.columns if "price" in c.lower() or c == "Y house price of unit area"][0]
    feature_cols = [c for c in df.columns if c not in ["No", target_col]]
    
    # Generate EDA report
    report_lines = []
    report_lines.append("=" * 70)
    report_lines.append("REAL ESTATE DATASET - EXPLORATORY DATA ANALYSIS REPORT")
    report_lines.append("=" * 70)
    report_lines.append(f"\nDataset shape: {df.shape}")
    report_lines.append(f"\nColumns:\n  " + "\n  ".join(df.columns.tolist()))
    report_lines.append(f"\nTarget variable: {target_col}")
    report_lines.append(f"\nFeature columns: {', '.join(feature_cols)}")
    
    report_lines.append("\n" + "-" * 70)
    report_lines.append("SUMMARY STATISTICS (NUMERICAL FEATURES)")
    report_lines.append("-" * 70)
    report_lines.append("\n" + df.describe().to_string())
    
    report_lines.append("\n" + "-" * 70)
    report_lines.append("MISSING VALUES")
    report_lines.append("-" * 70)
    report_lines.append("\n" + df.isnull().sum().to_string())
    
    report_lines.append("\n" + "-" * 70)
    report_lines.append("CORRELATION WITH TARGET")
    report_lines.append("-" * 70)
    corr_with_target = df[feature_cols + [target_col]].corr()[target_col].sort_values(ascending=False)
    report_lines.append("\n" + corr_with_target.to_string())
    
    # Write report
    with open(args.output_report, "w") as f:
        f.write("\n".join(report_lines))
    
    print(f"[EDA] Report written to {args.output_report}")
    
    # Create histogram of target variable
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.hist(df[target_col], bins=30, edgecolor="black", alpha=0.7, color="steelblue")
    ax.set_xlabel("House Price (per unit area)")
    ax.set_ylabel("Frequency")
    ax.set_title("Distribution of House Prices")
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(args.output_histogram, dpi=100)
    plt.close()
    print(f"[EDA] Histogram saved to {args.output_histogram}")
    
    # Create correlation matrix heatmap
    corr_matrix = df[feature_cols + [target_col]].corr()
    fig, ax = plt.subplots(figsize=(10, 8))
    sns.heatmap(corr_matrix, annot=True, cmap="coolwarm", center=0,
                square=True, linewidths=0.5, ax=ax)
    ax.set_title("Correlation Matrix", fontsize=14)
    plt.tight_layout()
    plt.savefig(args.output_corr, dpi=100)
    plt.close()
    print(f"[EDA] Correlation matrix saved to {args.output_corr}")
    
    print("[EDA] Complete!")


if __name__ == "__main__":
    main()
