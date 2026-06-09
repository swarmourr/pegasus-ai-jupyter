#!/usr/bin/env python3
"""
Pegasus WMS workflow generator for Real Estate Price Prediction.
Generates a DAG with EDA, preprocessing, parallel model training, and evaluation.

Usage:
    python workflow_generator.py
    pegasus-plan --sites local --output-sites local workflow.yml
"""
import os
import sys
from Pegasus.api import *

# ──────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────
WORK_DIR = os.path.dirname(os.path.abspath(__file__))
BIN_DIR = os.path.join(WORK_DIR, "bin")
INPUT_CSV = os.path.join(os.path.dirname(WORK_DIR), "Real estate.csv")

# Output directory for planned workflow
OUTPUT_DIR = os.path.join(WORK_DIR, "output")

# ──────────────────────────────────────────────
# Container definition (Docker)
# ──────────────────────────────────────────────
container = Container(
    "ml-container",
    Container.DOCKER,
    image="realestate-ml:latest",
    # Mount the workflow directory so scripts and data are accessible
    mounts=["{WORK_DIR}:/opt/workflow:ro".format(WORK_DIR=WORK_DIR)]
)

# ──────────────────────────────────────────────
# Site Catalog
# ──────────────────────────────────────────────
sc = SiteCatalog()

local_site = Site("local", arch=Arch.X86_64, os_type=OS.LINUX)
local_site.add_directories(
    Directory(Directory.SHARED_STORAGE, path=WORK_DIR)
        .add_file(File("realestate.csv"))
)

sc.add_sites(local_site)
sc.write()

print("[SC] Site catalog written to sites.yml")

# ──────────────────────────────────────────────
# Transformation Catalog
# ──────────────────────────────────────────────
tc = TransformationCatalog()

# EDA transformation
eda_trans = Transformation(
    "eda",
    site="local",
    pfn="/opt/workflow/bin/eda.py",
    is_stageable=False,
    container=container
)

# Preprocess transformation
preprocess_trans = Transformation(
    "preprocess",
    site="local",
    pfn="/opt/workflow/bin/preprocess.py",
    is_stageable=False,
    container=container
)

# Training transformations (one for each model type)
train_lr_trans = Transformation(
    "train_linear_regression",
    site="local",
    pfn="/opt/workflow/bin/train.py",
    is_stageable=False,
    container=container
)

train_rf_trans = Transformation(
    "train_random_forest",
    site="local",
    pfn="/opt/workflow/bin/train.py",
    is_stageable=False,
    container=container
)

train_gb_trans = Transformation(
    "train_gradient_boosting",
    site="local",
    pfn="/opt/workflow/bin/train.py",
    is_stageable=False,
    container=container
)

# Evaluation transformation
evaluate_trans = Transformation(
    "evaluate",
    site="local",
    pfn="/opt/workflow/bin/evaluate.py",
    is_stageable=False,
    container=container
)

tc.add_transformations(
    eda_trans, preprocess_trans,
    train_lr_trans, train_rf_trans, train_gb_trans,
    evaluate_trans
)
tc.write()

print("[TC] Transformation catalog written to tc.yml")

# ──────────────────────────────────────────────
# Replica Catalog (input data)
# ──────────────────────────────────────────────
rc = ReplicaCatalog()

input_file = File("realestate.csv")
rc.add_replica("local", "realestate.csv", INPUT_CSV)

rc.write()

print("[RC] Replica catalog written to rc.yml")

# ──────────────────────────────────────────────
# Workflow Definition
# ──────────────────────────────────────────────
wf = Workflow("realestate-prediction", infer_dependencies=True)

# ---- Files shared between jobs ----
# EDA outputs
eda_report = File("eda_report.txt")
histogram_plot = File("histogram.png")
correlation_plot = File("correlation_matrix.png")

# Preprocessing outputs
train_x = File("train_x.csv")
train_y = File("train_y.csv")
test_x = File("test_x.csv")
test_y = File("test_y.csv")
scaler = File("scaler.pkl")

# Model outputs
lr_model = File("lr_model.pkl")
lr_metrics = File("lr_metrics.json")

rf_model = File("rf_model.pkl")
rf_metrics = File("rf_metrics.json")

gb_model = File("gb_model.pkl")
gb_metrics = File("gb_metrics.json")

# Evaluation outputs
eval_report = File("evaluation_report.txt")
best_model = File("best_model.pkl")
predictions = File("predictions.csv")

# ---- Job 1: EDA ----
job_eda = Job(eda_trans)
job_eda.add_inputs(input_file)
job_eda.add_outputs(eda_report, histogram_plot, correlation_plot)
job_eda.add_args(
    "--input", input_file,
    "--output_report", eda_report,
    "--output_histogram", histogram_plot,
    "--output_corr", correlation_plot
)
wf.add_jobs(job_eda)

# ---- Job 2: Preprocessing ----
job_preprocess = Job(preprocess_trans)
job_preprocess.add_inputs(input_file)
job_preprocess.add_outputs(train_x, train_y, test_x, test_y, scaler)
job_preprocess.add_args(
    "--input", input_file,
    "--output_train_x", train_x,
    "--output_train_y", train_y,
    "--output_test_x", test_x,
    "--output_test_y", test_y,
    "--output_scaler", scaler,
    "--test_size", "0.2",
    "--random_state", "42"
)
wf.add_jobs(job_preprocess)

# ---- Job 3a: Train Linear Regression ----
job_lr = Job(train_lr_trans)
job_lr.add_inputs(train_x, train_y)
job_lr.add_outputs(lr_model, lr_metrics)
job_lr.add_args(
    "--train_x", train_x,
    "--train_y", train_y,
    "--model_type", "linear_regression",
    "--output_model", lr_model,
    "--output_metrics", lr_metrics,
    "--random_state", "42"
)
wf.add_jobs(job_lr)

# ---- Job 3b: Train Random Forest ----
job_rf = Job(train_rf_trans)
job_rf.add_inputs(train_x, train_y)
job_rf.add_outputs(rf_model, rf_metrics)
job_rf.add_args(
    "--train_x", train_x,
    "--train_y", train_y,
    "--model_type", "random_forest",
    "--output_model", rf_model,
    "--output_metrics", rf_metrics,
    "--random_state", "42"
)
wf.add_jobs(job_rf)

# ---- Job 3c: Train Gradient Boosting ----
job_gb = Job(train_gb_trans)
job_gb.add_inputs(train_x, train_y)
job_gb.add_outputs(gb_model, gb_metrics)
job_gb.add_args(
    "--train_x", train_x,
    "--train_y", train_y,
    "--model_type", "gradient_boosting",
    "--output_model", gb_model,
    "--output_metrics", gb_metrics,
    "--random_state", "42"
)
wf.add_jobs(job_gb)

# ---- Job 4: Evaluate (fan-in merge) ----
job_evaluate = Job(evaluate_trans)
job_evaluate.add_inputs(
    test_x, test_y,
    lr_model, rf_model, gb_model,
    lr_metrics, rf_metrics, gb_metrics
)
job_evaluate.add_outputs(
    eval_report, best_model, predictions,
    stage_out=True  # Final outputs → stage out
)
job_evaluate.add_args(
    "--test_x", test_x,
    "--test_y", test_y,
    "--model_lr", lr_model,
    "--model_rf", rf_model,
    "--model_gb", gb_model,
    "--metrics_lr", lr_metrics,
    "--metrics_rf", rf_metrics,
    "--metrics_gb", gb_metrics,
    "--output_report", eval_report,
    "--output_best_model", best_model,
    "--output_predictions", predictions,
    "--random_state", "42"
)
wf.add_jobs(job_evaluate)

# ---- Catalog registration ----
wf.add_site_catalog(sc)
wf.add_transformation_catalog(tc)
wf.add_replica_catalog(rc)

# ---- Write workflow YAML ----
wf.write()

print("\n" + "=" * 70)
print("WORKFLOW GENERATED SUCCESSFULLY")
print("=" * 70)
print(f"  Location: {WORK_DIR}")
print(f"  DAG: {wf.name}")
print(f"  Jobs: {len(wf.jobs)}")
print(f"  EDA → Preprocess → 3 parallel models → Evaluate")
print(f"  Container: realestate-ml:latest (Docker)")
print(f"  Outputs (staged out):")
print(f"    - evaluation_report.txt")
print(f"    - best_model.pkl")
print(f"    - predictions.csv")
print("=" * 70)
print()
print("Next steps:")
print("  1. Build the Docker container:")
print(f"     docker build -t realestate-ml:latest {WORK_DIR}")
print()
print("  2. Plan the workflow:")
print(f"     pegasus-plan --sites local --output-sites local {os.path.join(WORK_DIR, 'workflow.yml')}")
print()
print("  3. (Optional) Submit immediately:")
print(f"     pegasus-plan --sites local --output-sites local --submit {os.path.join(WORK_DIR, 'workflow.yml')}")
print("=" * 70)
