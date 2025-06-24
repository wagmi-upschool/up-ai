#!/usr/bin/env python3
"""
Improved script to parse Denizbank tariff PDF and convert to CSV format
"""

import pdfplumber
import pandas as pd
import re
import sys
from pathlib import Path

def extract_tables_from_pdf(pdf_path):
    """Extract tables from PDF using pdfplumber table detection"""
    all_tables = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            print(f"Processing page {page_num + 1}")
            
            # Try to extract tables
            tables = page.extract_tables()
            if tables:
                for i, table in enumerate(tables):
                    print(f"Found table {i+1} on page {page_num + 1} with {len(table)} rows")
                    all_tables.extend(table)
            
            # Also extract text for manual parsing
            text = page.extract_text()
            if text:
                lines = text.split('\n')
                for line in lines:
                    if re.match(r'^\d+\s+\d+\s+\d+\.\d+\.\d+', line):
                        # This looks like a data row
                        parts = re.split(r'\s+', line.strip())
                        if len(parts) >= 3:
                            all_tables.append(parts)
    
    return all_tables

def parse_text_based_extraction(pdf_path):
    """Extract data using text-based approach with improved parsing"""
    data = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            text = page.extract_text()
            if not text:
                continue
                
            lines = text.split('\n')
            current_section = ""
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                # Look for section headers
                if re.match(r'^\d+\.\d+\.?\s+[A-Za-zÇĞıİÖŞÜçğıiöşü\s]+$', line) and not re.search(r'\d+\.\d+\.\d+', line):
                    current_section = line
                    continue
                
                # Look for data rows with pattern: [rapor_no] [vega_no] [service_name] [currency] [amounts] [date]
                row_pattern = r'^(\d+)\s+(\d+)\s+(\d+\.\d+\.\d+)(.+)'
                match = re.match(row_pattern, line)
                
                if match:
                    rapor_sira_no = match.group(1)
                    vega_extra = match.group(2)  # Sometimes there's an extra number
                    vega_sira_no = match.group(3)
                    rest = match.group(4).strip()
                    
                    # Parse the rest of the line
                    parts = rest.split()
                    
                    # Extract service name (everything before currency or numbers)
                    service_name = ""
                    currency = ""
                    amounts = []
                    date = ""
                    description = ""
                    
                    i = 0
                    # Extract service name until we hit currency or numbers
                    while i < len(parts):
                        if parts[i] in ['TRY', 'USD', 'EUR', 'TL']:
                            currency = parts[i]
                            i += 1
                            break
                        elif re.match(r'^\d+$', parts[i]):
                            break
                        else:
                            service_name += parts[i] + " "
                            i += 1
                    
                    service_name = service_name.strip()
                    
                    # Extract amounts
                    while i < len(parts):
                        if re.match(r'^\d+$', parts[i]):
                            amounts.append(parts[i])
                        elif re.match(r'^\d{2}\.\d{2}\.\d{4}$', parts[i]):
                            date = parts[i]
                        elif parts[i] in ['BSMV', 'Hariç']:
                            description += parts[i] + " "
                        i += 1
                    
                    # Create row
                    row = {
                        'VegaSıraNo': vega_sira_no,
                        'RaporSıraNo': rapor_sira_no,
                        'Kalem_Adı': service_name,
                        'Para_Birimi': currency,
                        'Asgari_Tutar': amounts[0] if len(amounts) > 0 else '',
                        'Asgari_Oran': '',
                        'Azami_Tutar': amounts[1] if len(amounts) > 1 else '',
                        'Azami_Oran': '',
                        'Açıklama': description.strip(),
                        'Güncelleme_Tarihi': date
                    }
                    
                    data.append(row)
                    print(f"Extracted: {rapor_sira_no} | {vega_sira_no} | {service_name[:30]}...")
    
    return data

def main():
    pdf_path = "/Users/yusuf/Software/Projects/AI-ML/up-ai/denizbank ticari müşteri masraf komisyon listesi (1).pdf"
    
    if not Path(pdf_path).exists():
        print(f"Error: PDF file not found at {pdf_path}")
        return
    
    print("Extracting data from PDF using improved text parsing...")
    data = parse_text_based_extraction(pdf_path)
    
    if data:
        # Create DataFrame
        df = pd.DataFrame(data)
        
        # Save to CSV
        output_file = "denizbank_tariff_data_v2.csv"
        df.to_csv(output_file, index=False, encoding='utf-8-sig')
        print(f"\nData saved to {output_file}")
        print(f"Total rows: {len(df)}")
        print("\nFirst few rows:")
        print(df.head().to_string())
        
        # Show sample of extracted data
        print(f"\nSample of extracted data:")
        for i, row in enumerate(df.head(3).iterrows()):
            print(f"Row {i+1}: {row[1]['VegaSıraNo']} - {row[1]['Kalem_Adı']} - {row[1]['Para_Birimi']} - {row[1]['Asgari_Tutar']}")
            
    else:
        print("No data was extracted from the PDF")
        
        # Try table extraction as fallback
        print("\nTrying table extraction...")
        tables = extract_tables_from_pdf(pdf_path)
        if tables:
            print(f"Found {len(tables)} table rows")
            # Save raw table data
            with open("raw_table_data.txt", "w", encoding="utf-8") as f:
                for row in tables:
                    f.write(str(row) + "\n")
            print("Raw table data saved to raw_table_data.txt")

if __name__ == "__main__":
    main()