"""
pdf_overlay.py — Coordinate-based text overlay for Hearth & Page
================================================================
Used for any PDF form where field-fill (fill_pdf.py) cannot place
text into a specific area, or as a standalone strategy for static/
shallow-AcroForm PDFs.

Strategy
--------
Rather than writing to AcroForm /V slots, this module stamps visible
text directly onto the page at known (x, y) coordinates using
ReportLab to produce a transparent overlay page, then merges that
overlay onto the source PDF with pypdf.

This is robust to:
  - XFA / LiveCycle PDFs that resist field-fill
  - Flattened PDFs with no form fields
  - Any form where field coordinates drift between revisions
    (coordinates can be re-calibrated in one place)

Usage
-----
    from pdf_overlay import overlay_pdf

    overlay_pdf(
        input_path  = "form14a.pdf",
        output_path = "form14a_filled.pdf",
        page_ops    = [
            # page_index is 0-based
            OverlayOp(page=0, x=434.8, y=716.0, text="FC-2026-12345", font_size=9),
            OverlayOp(page=0, x=33.8,  y=716.0, text="Toronto — Superior Court of Justice", font_size=9),
            # ... more fields ...
        ]
    )

Coordinate system
-----------------
ReportLab and pypdf both use PDF user units (points, 1/72 inch) with
the origin at the BOTTOM-LEFT of the page.  The /Rect values from
pypdf are [x0, y0, x1, y1] where y0 < y1.  Use y0 + 2 (or the
midpoint) as the baseline for text to sit inside the field box.

Font defaults
-------------
Helvetica is a built-in PDF font — no embedding needed.  Use
Helvetica-Bold for headings, Helvetica for body.

Dependencies
------------
    pip install reportlab pypdf
"""

from __future__ import annotations

import io
import os
import sys
from dataclasses import dataclass, field
from typing import List, Optional

import pypdf
import pypdf.generic
from reportlab.lib.colors import black
from reportlab.pdfgen import canvas as rl_canvas


# ─── Data types ────────────────────────────────────────────────────────────────

@dataclass
class OverlayOp:
    """A single text stamp operation for one page."""
    page:      int          # 0-based page index
    x:         float        # left edge of text in PDF points (origin = bottom-left)
    y:         float        # baseline of text in PDF points
    text:      str          # value to stamp
    font_size: float = 9.0
    font_name: str   = "Helvetica"
    color:     tuple = (0, 0, 0)   # RGB 0-1


# ─── Core functions ────────────────────────────────────────────────────────────

def _build_overlay_page(width: float, height: float, ops: List[OverlayOp]) -> bytes:
    """
    Render one PDF page (transparent background) containing all the
    text stamps for that page.  Returns raw PDF bytes.
    """
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(width, height))
    c.setFillColorRGB(0, 0, 0)

    for op in ops:
        if not op.text:
            continue
        c.setFont(op.font_name, op.font_size)
        r, g, b = op.color
        c.setFillColorRGB(r, g, b)
        c.drawString(op.x, op.y, str(op.text))

    c.save()
    buf.seek(0)
    return buf.read()


def overlay_pdf(
    input_path:  str,
    output_path: str,
    page_ops:    List[OverlayOp],
) -> int:
    """
    Stamp text onto `input_path` at the specified coordinates and
    write the result to `output_path`.

    Returns the number of text ops applied (excluding empty strings).
    """
    reader = pypdf.PdfReader(input_path)
    writer = pypdf.PdfWriter()

    # Group ops by page
    ops_by_page: dict[int, List[OverlayOp]] = {}
    for op in page_ops:
        ops_by_page.setdefault(op.page, []).append(op)

    applied = 0

    for page_idx, page in enumerate(reader.pages):
        writer.add_page(page)
        ops_this_page = ops_by_page.get(page_idx, [])

        non_empty = [op for op in ops_this_page if op.text]
        if not non_empty:
            continue

        mb = page.mediabox
        w  = float(mb.width)
        h  = float(mb.height)

        overlay_bytes = _build_overlay_page(w, h, non_empty)

        overlay_reader = pypdf.PdfReader(io.BytesIO(overlay_bytes))
        overlay_page   = overlay_reader.pages[0]

        # Merge overlay onto the page already added to writer
        writer.pages[page_idx].merge_page(overlay_page)
        applied += len(non_empty)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "wb") as fh:
        writer.write(fh)

    return applied


# ─── Form 14A coordinate map ───────────────────────────────────────────────────
# These coordinates were extracted from the live Ontario form14a.pdf
# using pypdf field /Rect inspection (see docs/forms/FORM_INVENTORY.md).
# Update these if the form revision changes.
#
# Convention: y = rect[1] + 2  (2pt above the bottom of the field box)

def build_form14a_ops(d: dict) -> List[OverlayOp]:
    """
    Convert a flat dict of field values into OverlayOp list for Form 14A.

    Expected keys (all optional — missing/empty keys are skipped):
        court_file_number, courthouse, court_office_address, dated,
        applicant_full_name, applicant_address,
        applicant_lawyer_name, applicant_lawyer_address,
        respondent_full_name, respondent_address,
        respondent_lawyer_name, respondent_lawyer_address,
        deponent_name, deponent_municipality,
        affidavit_body,
        signature_municipality, signature_province,
        signature_date, commissioner_name
    """
    def v(key: str) -> str:
        return str(d.get(key, "") or "")

    ops: List[OverlayOp] = [
        # ── Page 1 ──────────────────────────────────────────────────────────
        # Court file number (top-right)
        OverlayOp(page=0, x=434.8, y=714.5, text=v("court_file_number"), font_size=9),
        # Court name (top-left dropdown label)
        OverlayOp(page=0, x=33.8,  y=716.0, text=v("courthouse"),         font_size=9),
        # Court office address
        OverlayOp(page=0, x=33.8,  y=687.5, text=v("court_office_address"), font_size=9),
        # Dated line
        OverlayOp(page=0, x=434.5, y=662.8, text=v("dated"),               font_size=9),
        # Applicant name + address (left column)
        OverlayOp(page=0, x=18.0,  y=596.7, text=v("applicant_full_name"),    font_size=9),
        OverlayOp(page=0, x=18.0,  y=570.8, text=v("applicant_address"),       font_size=8),
        # Applicant lawyer name + address (right column)
        OverlayOp(page=0, x=315.0, y=596.7, text=v("applicant_lawyer_name"),   font_size=9),
        OverlayOp(page=0, x=315.0, y=570.8, text=v("applicant_lawyer_address"), font_size=8),
        # Respondent name + address (left column, lower block)
        OverlayOp(page=0, x=18.0,  y=502.8, text=v("respondent_full_name"),   font_size=9),
        OverlayOp(page=0, x=18.0,  y=476.9, text=v("respondent_address"),      font_size=8),
        # Respondent lawyer name + address (right column)
        OverlayOp(page=0, x=315.0, y=502.8, text=v("respondent_lawyer_name"),  font_size=9),
        OverlayOp(page=0, x=315.0, y=476.9, text=v("respondent_lawyer_address"), font_size=8),
        # Deponent name line
        OverlayOp(page=0, x=143.0, y=441.0, text=v("deponent_name"),           font_size=9),
        # Municipality line
        OverlayOp(page=0, x=156.7, y=421.6, text=v("deponent_municipality"),   font_size=9),
        # Affidavit body (large text area, page 1)
        OverlayOp(page=0, x=28.3,  y=340.0, text=v("affidavit_body_p1"),       font_size=9),

        # ── Page 2 ──────────────────────────────────────────────────────────
        # Court file number repeat (top-right)
        OverlayOp(page=1, x=434.4, y=746.4, text=v("court_file_number"),        font_size=9),
        # Dated repeat (top-left, #field[1] rect=[190.0,754.2,272.3,769.0])
        OverlayOp(page=1, x=190.0, y=756.2, text=v("dated"),                    font_size=9),
        # Continuation of affidavit body
        OverlayOp(page=1, x=28.1,  y=715.0, text=v("affidavit_body_p2"),        font_size=9),
        # Commissioner section
        OverlayOp(page=1, x=148.1, y=177.4, text=v("signature_municipality"),   font_size=9),
        OverlayOp(page=1, x=34.8,  y=148.7, text=v("signature_province"),       font_size=9),
        OverlayOp(page=1, x=34.8,  y=119.8, text=v("signature_date"),           font_size=9),
        OverlayOp(page=1, x=175.7, y=120.3, text=v("commissioner_name"),        font_size=9),
    ]

    # Filter out empty strings so they don't print blank
    return [op for op in ops if op.text.strip()]


# ─── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    """
    Quick smoke test:
        python pdf_overlay.py <input.pdf> <output.pdf>
    Uses built-in sample data for Form 14A.
    """
    import json

    if len(sys.argv) >= 3:
        input_pdf  = sys.argv[1]
        output_pdf = sys.argv[2]
        data_file  = sys.argv[3] if len(sys.argv) >= 4 else None
    else:
        print("Usage: python pdf_overlay.py <input.pdf> <output.pdf> [data.json]")
        sys.exit(1)

    if data_file:
        with open(data_file) as fh:
            data = json.load(fh)
        # Support both flat dict and fieldKey/fieldValue list
        if isinstance(data, list):
            data = {item["fieldKey"]: item["fieldValue"] for item in data
                    if "fieldKey" in item}
    else:
        # Built-in sample data
        data = {
            "court_file_number":        "FC-2026-99999",
            "courthouse":               "Toronto — Superior Court of Justice",
            "court_office_address":     "393 University Ave, Toronto ON  M5G 1E6",
            "dated":                    "2026-06-30",
            "applicant_full_name":      "Jane Sample Applicant",
            "applicant_address":        "123 King St W, Unit 4, Toronto ON  M5H 1A1",
            "applicant_lawyer_name":    "Ms. Sample Lawyer",
            "applicant_lawyer_address": "200 Bay St, Toronto ON  M5J 2J1",
            "respondent_full_name":     "John Sample Respondent",
            "respondent_address":       "456 Queen St E, Toronto ON  M5A 1T7",
            "respondent_lawyer_name":   "Mr. Other Lawyer",
            "respondent_lawyer_address":"100 Front St W, Toronto ON  M5J 1E3",
            "deponent_name":            "Jane Sample Applicant",
            "deponent_municipality":    "Toronto",
            "affidavit_body_p1":        "I am the applicant in this proceeding and I have personal knowledge of the matters set out in this affidavit.",
            "affidavit_body_p2":        "(continued if needed)",
            "signature_municipality":   "Toronto",
            "signature_province":       "Ontario",
            "signature_date":           "June 30, 2026",
            "commissioner_name":        "A. Commissioner, Notary Public",
        }

    ops   = build_form14a_ops(data)
    count = overlay_pdf(input_pdf, output_pdf, ops)
    print(f"overlay_pdf: {count} text ops applied → {output_pdf}")
