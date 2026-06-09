#!/usr/bin/env python3
"""
Wrapper script for `diamond makedb` — builds a Diamond protein database
from a FASTA file of reference sequences.

Usage:
    python makedb.py --input reference.faa --output reference.dmnd [--verbose]
"""
import argparse
import subprocess
import sys
import os


def main():
    parser = argparse.ArgumentParser(description="Build Diamond database from FASTA")
    parser.add_argument("--input", required=True, help="Input reference FASTA file (.faa / .fa)")
    parser.add_argument("--output", required=True, help="Output Diamond database file (.dmnd)")
    parser.add_argument("--verbose", action="store_true", default=False, help="Print progress")
    parser.add_argument("--threads", type=int, default=4, help="Number of CPU threads (default: 4)")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"ERROR: Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    cmd = [
        "diamond", "makedb",
        "--in", args.input,
        "--db", args.output,
        "--threads", str(args.threads),
    ]

    if args.verbose:
        cmd.append("--verbose")
        print(f"Running: {' '.join(cmd)}")
        sys.stdout.flush()

    try:
        result = subprocess.run(cmd, check=True, capture_output=not args.verbose, text=True)
        if args.verbose:
            print(result.stdout)
        print(f"SUCCESS: Diamond database created at {args.output}")
    except subprocess.CalledProcessError as e:
        print(f"ERROR: diamond makedb failed (exit code {e.returncode})", file=sys.stderr)
        if e.stderr:
            print(e.stderr, file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print("ERROR: 'diamond' not found in PATH. Is Diamond installed?", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
