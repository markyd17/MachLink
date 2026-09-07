"""
Extracts raw text from a checklist PDF you legally own (a Chuck's Guide or
JayDee's Checklist PDF you downloaded yourself) so you can read through it
and hand-curate the relevant sections into a proper aircraft JSON file.

This intentionally does NOT try to auto-structure the PDF into JSON. Guide
formatting varies too much airframe to airframe for that to be reliable,
and the whole point of this project is that a human confirms the content
once rather than trusting an automated/LLM guess. Think of this as turning
a PDF into a searchable .txt you can copy from.

Usage:
    python tools/pdf_import.py path/to/guide.pdf --out data/aircraft/draft_hornet.txt
"""
import argparse
import pdfplumber


def extract(pdf_path, out_path):
    lines = []
    page_count = 0
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            lines.append(f"\n----- PAGE {i} -----\n")
            lines.append(text)
            page_count = i
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Extracted {page_count} pages -> {out_path}")
    print("Next: read through this file and hand-copy the relevant sections")
    print("into a new data/aircraft/<name>.json, following _TEMPLATE.json.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf_path", help="Path to the checklist PDF you own")
    parser.add_argument("--out", required=True, help="Where to write the extracted .txt draft")
    args = parser.parse_args()
    extract(args.pdf_path, args.out)
