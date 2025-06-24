#!/usr/bin/env python3
"""
Script to parse Denizbank tariff PDF and convert to CSV format
"""

import pdfplumber
import pandas as pd
import re
import sys
from pathlib import Path

def extract_text_from_pdf(pdf_path):
    """Extract text from PDF file"""
    text_content = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            print(f"Processing page {page_num + 1}")
            text = page.extract_text()
            if text:
                text_content.append(text)
                print(f"Page {page_num + 1} text preview:")
                print(text[:500] + "..." if len(text) > 500 else text)
                print("-" * 80)
    
    return "\n".join(text_content)

def parse_tariff_data(text):
    """Parse the tariff data from extracted text"""
    lines = text.split('\n')
    
    # Define column names based on the requirements
    columns = [
        'VegaSıraNo', 'RaporSıraNo', 'Kalem_Adı', 'Para_Birimi', 
        'Asgari_Tutar', 'Asgari_Oran', 'Azami_Tutar', 'Azami_Oran', 
        'Açıklama', 'Güncelleme_Tarihi'
    ]
    
    data = []
    current_service = ""
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        print(f"Processing line: {line[:100]}...")
        
        # Look for section headers (like "1.1 Kredi Tahsis ve Kredi Kullandırım")
        section_pattern = r'^(\d+\.\d+)\s+(.+)'
        section_match = re.match(section_pattern, line)
        if section_match and not re.match(r'^\d+\.\d+\.\d+', line):
            current_service = section_match.group(2).strip()
            print(f"Found service section: {current_service}")
            continue
        
        # Look for detailed entries (like "1.1.1Kredi Tahsis ve Kredi Kullandırım Ücreti")
        entry_pattern = r'^(\d+)?\s*(\d+\.\d+\.\d+)(.+)'
        entry_match = re.match(entry_pattern, line)
        
        if entry_match:
            rapor_sira_no = entry_match.group(1) if entry_match.group(1) else ''
            vega_sira_no = entry_match.group(2)
            rest_of_line = entry_match.group(3).strip()
            
            # Extract service name from the beginning of rest_of_line
            service_name = ""
            remaining_text = rest_of_line
            
            # Look for currency indicators to split service name from data
            currencies = ['TRY', 'USD', 'EUR', 'TL']
            split_point = -1
            
            for currency in currencies:
                if currency in remaining_text:
                    split_point = remaining_text.find(currency)
                    break
            
            if split_point > 0:
                service_name = remaining_text[:split_point].strip()
                data_part = remaining_text[split_point:].strip()
            else:
                # If no currency found, try to find numeric patterns
                numeric_pattern = r'(\d+(?:\.\d+)?)'
                match = re.search(numeric_pattern, remaining_text)
                if match:
                    split_point = match.start()
                    service_name = remaining_text[:split_point].strip()
                    data_part = remaining_text[split_point:].strip()
                else:
                    service_name = remaining_text
                    data_part = ""
            
            # Parse the data part
            fields = re.split(r'\s+', data_part) if data_part else []
            
            # Create a row
            row = {
                'VegaSıraNo': vega_sira_no,
                'RaporSıraNo': rapor_sira_no,
                'Kalem_Adı': service_name if service_name else current_service,
                'Para_Birimi': '',
                'Asgari_Tutar': '',
                'Asgari_Oran': '',
                'Azami_Tutar': '',
                'Azami_Oran': '',
                'Açıklama': '',
                'Güncelleme_Tarihi': ''
            }
            
            # Fill in fields from parsed data
            currency_found = False
            numeric_values = []
            
            for field in fields:
                if field in ['TRY', 'USD', 'EUR', 'TL']:
                    row['Para_Birimi'] = field
                    currency_found = True
                elif re.match(r'^\d+(\.\d+)?$', field):
                    numeric_values.append(field)
                elif re.match(r'^\d+(\.\d+)?%$', field):
                    if not row['Asgari_Oran']:
                        row['Asgari_Oran'] = field
                    else:
                        row['Azami_Oran'] = field
                elif re.match(r'\d{2}\.\d{2}\.\d{4}', field):
                    row['Güncelleme_Tarihi'] = field
                elif 'BSMV' in field or 'Hariç' in field:
                    row['Açıklama'] = row['Açıklama'] + ' ' + field if row['Açıklama'] else field
            
            # Assign numeric values to min/max amounts
            if len(numeric_values) >= 1:
                row['Asgari_Tutar'] = numeric_values[0]
            if len(numeric_values) >= 2:
                row['Azami_Tutar'] = numeric_values[1]
            
            data.append(row)
            print(f"Parsed row: {vega_sira_no} - {service_name}")
    
    return data, columns

def main():
    pdf_path = "/Users/yusuf/Software/Projects/AI-ML/up-ai/denizbank ticari müşteri masraf komisyon listesi (1).pdf"
    
    if not Path(pdf_path).exists():
        print(f"Error: PDF file not found at {pdf_path}")
        return
    
    print("Extracting text from PDF...")
    text = extract_text_from_pdf(pdf_path)
    
    print("\nParsing tariff data...")
    data, columns = parse_tariff_data(text)
    
    if data:
        # Create DataFrame
        df = pd.DataFrame(data)
        
        # Save to CSV
        output_file = "denizbank_tariff_data.csv"
        df.to_csv(output_file, index=False, encoding='utf-8-sig')
        print(f"\nData saved to {output_file}")
        print(f"Total rows: {len(df)}")
        print("\nFirst few rows:")
        print(df.head())
    else:
        print("No data was extracted from the PDF")

if __name__ == "__main__":
    main()