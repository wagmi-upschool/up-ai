#!/usr/bin/env python3
"""
Analyze PDF structure to understand missing field patterns
"""

import pdfplumber
import re

def analyze_pdf_structure(pdf_path):
    """Analyze the PDF to understand field patterns"""
    
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            text = page.extract_text()
            if not text:
                continue
                
            print(f"\n=== PAGE {page_num + 1} ===")
            lines = text.split('\n')
            
            for i, line in enumerate(lines):
                line = line.strip()
                if not line:
                    continue
                
                # Look for lines that start with numbers or contain service names
                if (re.match(r'^\d+', line) or 
                    'Kredi' in line or 
                    'Ücreti' in line or
                    re.match(r'^\d+\.\d+', line)):
                    
                    print(f"Line {i:3}: {line}")
                    
                    # Show next few lines for context
                    for j in range(1, 3):
                        if i + j < len(lines) and lines[i + j].strip():
                            print(f"     +{j}: {lines[i + j].strip()}")
                    print()

def main():
    pdf_path = "/Users/yusuf/Software/Projects/AI-ML/up-ai/denizbank ticari müşteri masraf komisyon listesi (1).pdf"
    analyze_pdf_structure(pdf_path)

if __name__ == "__main__":
    main()