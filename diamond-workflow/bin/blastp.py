#!/usr/bin/env python3
"""
Wrapper script for `diamond blastp` — aligns query protein sequences
against a Diamond database.

Usage:
    python blastp.py --query queries.faa --db reference.dmnd --output results.tsv [--evalue 1e-5] [--threads 4] [--verbose]
"""
import argparse
import subprocess
import sys
import os


def main():
    parser = argparse.ArgumentParser(description="Run Diamond blastp alignment")
    parser.add_argument("--query", required=True, help="Query FASTA file (.faa / .fa)")
    parser.add_argument("--db", required=True, help="Diamond database file (.dmnd)")
    parser.add_argument("--output", required=True, help="Output alignment file (TSV format)")
    parser.add_argument("--evalue", type=float, default=1e-5, help="E-value threshold (default: 1e-5)")
    parser.add_argument("--max-target-seqs", type=int, default=25, help="Max target sequences per query (default: 25)")
    parser.add_argument("--threads", type=int, default=4, help="Number of CPU threads (default: 4)")
    parser.add_argument("--verbose", action="store_true", default=False, help="Print progress")
    parser.add_argument("--sensitive", action="store_true", default=False, help="Use sensitive mode")
    args = parser.parse_args()

    # Validate inputs
    for fpath, label in [(args.query, "Query"), (args.db, "Database")]:
        if not os.path.isfile(fpath):
            print(f"ERROR: {label} file not found: {fpath}", file=sys.stderr)
            sys.exit(1)

    # Build command
    cmd = [
        "diamond", "blastp",
        "--query", args.query,
        "--db", args.db,
        "--out", args.output,
        "--outfmt", "6",  # BLAST tabular format
        "--evalue", str(args.evalue),
        "--max-target-seqs", str(args.max_target_seqs),
        "--threads", str(args.threads),
    ]

    if args.sensitive:
        cmd.append("--sensitive")
    if args.verbose:
        cmd.append("--verbose")

    if args.verbose:
        print(f"Running: {' '.join(cmd)}")
        sys.stdout.flush()

    try:
        result = subprocess.run(cmd, check=True, capture_output=not args.verbose, text=True)
        if args.verbose:
            print(result.stdout)
        print(f"SUCCESS: Alignment results written to {args.output}")

        # Count alignments
        if os.path.isfile(args.output):
            with open(args.output) as f:
                line_count = sum(1 for _ in f)
            print(f"  Total alignments reported: {line_count}")
    except subprocess.CalledProcessError as e:
        print(f"ERROR: diamond blastp failed (exit code {e.returncode})", file=sys.stderr)
        if e.stderr:
            print(e.stderr, file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print("ERROR: 'diamond' not found in PATH. Is Diamond installed?", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
