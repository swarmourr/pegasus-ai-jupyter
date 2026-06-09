#!/usr/bin/env python3
"""
Merge multiple Diamond BLAST result TSV files into a single summary.

For each input TSV, prepend a sample-name column so results are traceable.

Usage:
    python merge_results.py \
        --inputs sample1.tsv sample2.tsv sample3.tsv \
        --sample-names sample1 sample2 sample3 \
        --output merged_results.tsv
"""
import argparse
import sys
import os


# BLAST tabular format (outfmt 6) columns:
COLUMNS = [
    "qseqid",    # Query sequence ID
    "sseqid",    # Subject (reference) sequence ID
    "pident",    # Percentage identity
    "length",    # Alignment length
    "mismatch",  # Number of mismatches
    "gapopen",   # Number of gap openings
    "qstart",    # Start of alignment in query
    "qend",      # End of alignment in query
    "sstart",    # Start of alignment in subject
    "send",      # End of alignment in subject
    "evalue",    # Expect value
    "bitscore",  # Bit score
]


def main():
    parser = argparse.ArgumentParser(description="Merge Diamond BLAST results")
    parser.add_argument("--inputs", nargs="+", required=True, help="Input TSV files to merge")
    parser.add_argument("--sample-names", nargs="+", required=True, help="Sample names (one per input)")
    parser.add_argument("--output", required=True, help="Merged output TSV file")
    args = parser.parse_args()

    if len(args.inputs) != len(args.sample_names):
        print(f"ERROR: Number of inputs ({len(args.inputs)}) must match number of sample names ({len(args.sample_names)})",
              file=sys.stderr)
        sys.exit(1)

    total_lines = 0
    with open(args.output, "w") as out:
        # Write header
        header = ["sample"] + COLUMNS
        out.write("\t".join(header) + "\n")

        for input_path, sample_name in zip(args.inputs, args.sample_names):
            if not os.path.isfile(input_path):
                print(f"WARNING: Input file not found, skipping: {input_path}", file=sys.stderr)
                continue

            lines_written = 0
            with open(input_path) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    out.write(f"{sample_name}\t{line}\n")
                    lines_written += 1

            print(f"  {sample_name}: {lines_written} alignments merged from {input_path}")
            total_lines += lines_written

    print(f"\nSUCCESS: Merged results written to {args.output} ({total_lines} total alignments)")


if __name__ == "__main__":
    main()
