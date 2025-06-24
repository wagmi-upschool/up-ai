#!/usr/bin/env python3
"""
Improved script to parse Denizbank tariff PDF with proper field inheritance
"""

import pdfplumber
import pandas as pd
import re
import sys
from pathlib import Path

def parse_enhanced_extraction(pdf_path):
    """Extract data with proper field inheritance"""
    data = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            text = page.extract_text()
            if not text:
                continue
                
            lines = text.split('\n')
            
            # State variables for inheritance
            last_vega_sira_no = ""
            last_section = ""
            last_rapor_counter = 0
            
            for i, line in enumerate(lines):
                line = line.strip()
                if not line:
                    continue
                
                # Skip headers and form info
                if any(skip in line for skip in ['FORM ADI', 'FORM KODU', 'BANKA', 'VegaSıraNoRaporSıraNo']):
                    continue
                
                # Look for section headers like "1.1 Kredi Tahsis ve Kredi Kullandırım"
                section_match = re.match(r'^(\d+\.\d+)\s+(.+)$', line)
                if section_match and not re.search(r'\d+\.\d+\.\d+', line):
                    last_vega_sira_no = section_match.group(1)
                    last_section = section_match.group(2).strip()
                    last_rapor_counter = 0
                    print(f"Found section: {last_vega_sira_no} - {last_section}")
                    continue
                
                # Look for detailed entries with pattern: [rapor_no] [maybe extra] [vega_no] [service_name] [data...]
                # Pattern 1: "3 3 1.1.2İtibar/Niyet/Referans Mektubu..."
                detailed_match = re.match(r'^(\d+)\s+(\d+)\s+(\d+\.\d+\.\d+)(.+)', line)
                if detailed_match:
                    rapor_sira_no = detailed_match.group(1)
                    rapor_extra = detailed_match.group(2)  # Sometimes duplicated
                    vega_sira_no = detailed_match.group(3)
                    rest = detailed_match.group(4).strip()
                    
                    # Update state
                    last_vega_sira_no = vega_sira_no.rsplit('.', 1)[0]  # e.g., "1.1.2" -> "1.1"
                    last_rapor_counter = int(rapor_sira_no)
                    
                # Pattern 2: Lines that are just rapor numbers like "1K.r1e.1d.i1 Tahsis" or "1K.r1e.1d.i2 Kullandırım"
                elif re.match(r'^\d+K\.r1e\.1d\.i\d+\s+(.+)', line):
                    # This indicates a new sub-entry under the current section
                    last_rapor_counter += 1
                    rapor_sira_no = str(last_rapor_counter)
                    
                    # Extract service name
                    service_match = re.match(r'^\d+K\.r1e\.1d\.i\d+\s+(.+)', line)
                    service_name = service_match.group(1) if service_match else ""
                    
                    # Create VegaSıraNo by incrementing the last digit
                    if last_vega_sira_no:
                        parts = last_vega_sira_no.split('.')
                        if len(parts) >= 2:
                            vega_sira_no = f"{parts[0]}.{parts[1]}.{last_rapor_counter}"
                        else:
                            vega_sira_no = f"{last_vega_sira_no}.{last_rapor_counter}"
                    else:
                        vega_sira_no = f"1.1.{last_rapor_counter}"
                    
                    rest = ""
                
                # Pattern 3: Lines with just service names that should inherit previous numbers
                elif (any(keyword in line.lower() for keyword in ['ücreti', 'kullandırım', 'tahsis']) and 
                      not re.match(r'^\d+', line) and 
                      last_vega_sira_no):
                    
                    last_rapor_counter += 1
                    rapor_sira_no = str(last_rapor_counter)
                    
                    # Create VegaSıraNo 
                    parts = last_vega_sira_no.split('.')
                    if len(parts) >= 2:
                        vega_sira_no = f"{parts[0]}.{parts[1]}.{last_rapor_counter}"
                    else:
                        vega_sira_no = f"{last_vega_sira_no}.{last_rapor_counter}"
                    
                    rest = line
                    
                else:
                    continue
                
                # Parse the rest of the line for data fields
                if 'detailed_match' in locals() and detailed_match:
                    # For detailed matches, extract service name and data
                    service_and_data = rest
                    
                    # Find where the service name ends and data begins
                    currencies = ['TRY', 'USD', 'EUR', 'TL']
                    split_point = -1
                    
                    for currency in currencies:
                        if currency in service_and_data:
                            split_point = service_and_data.find(currency)
                            break
                    
                    if split_point > 0:
                        service_name = service_and_data[:split_point].strip()
                        data_part = service_and_data[split_point:].strip()
                    else:
                        # Try to find where numbers start
                        number_match = re.search(r'\s+\d+', service_and_data)
                        if number_match:
                            split_point = number_match.start()
                            service_name = service_and_data[:split_point].strip()
                            data_part = service_and_data[split_point:].strip()
                        else:
                            service_name = service_and_data
                            data_part = ""
                    
                    # Parse data fields
                    fields = re.split(r'\s+', data_part) if data_part else []
                    
                else:
                    # For inherited entries
                    service_name = rest
                    fields = []
                
                # Create row
                row = {
                    'VegaSıraNo': vega_sira_no,
                    'RaporSıraNo': rapor_sira_no,
                    'Kalem_Adı': service_name,
                    'Para_Birimi': '',
                    'Asgari_Tutar': '',
                    'Asgari_Oran': '',
                    'Azami_Tutar': '',
                    'Azami_Oran': '',
                    'Açıklama': '',
                    'Güncelleme_Tarihi': ''
                }
                
                # Fill in fields from parsed data
                numeric_values = []
                
                for field in fields:
                    if field in ['TRY', 'USD', 'EUR', 'TL']:
                        row['Para_Birimi'] = field
                    elif re.match(r'^\d+$', field):
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
                
                # Assign numeric values
                if len(numeric_values) >= 1:
                    row['Asgari_Tutar'] = numeric_values[0]
                if len(numeric_values) >= 2:
                    row['Azami_Tutar'] = numeric_values[1]
                
                data.append(row)
                print(f"Parsed: {rapor_sira_no} | {vega_sira_no} | {service_name[:40]}...")
                
                # Clear the match variable for next iteration
                if 'detailed_match' in locals():
                    del detailed_match
    
    return data

def main():
    pdf_path = "/Users/yusuf/Software/Projects/AI-ML/up-ai/denizbank ticari müşteri masraf komisyon listesi (1).pdf"
    
    if not Path(pdf_path).exists():
        print(f"Error: PDF file not found at {pdf_path}")
        return
    
    print("Extracting data with enhanced field inheritance...")
    data = parse_enhanced_extraction(pdf_path)
    
    if data:
        # Create DataFrame
        df = pd.DataFrame(data)
        
        # Clean up and fill missing currencies
        mask = (df['Para_Birimi'].isna() | (df['Para_Birimi'] == '')) & (df['Asgari_Tutar'].notna() & (df['Asgari_Tutar'] != ''))
        df.loc[mask, 'Para_Birimi'] = 'TRY'
        
        # Save to CSV
        output_file = "denizbank_tariff_complete.csv"
        df.to_csv(output_file, index=False, encoding='utf-8-sig')
        print(f"\nData saved to {output_file}")
        print(f"Total rows: {len(df)}")
        
        # Show examples of inherited fields
        print(f"\nExamples of field inheritance:")
        for i, row in df.head(10).iterrows():
            print(f"{row['RaporSıraNo']:2} | {row['VegaSıraNo']:6} | {row['Kalem_Adı'][:50]}")
            
    else:
        print("No data was extracted from the PDF")

if __name__ == "__main__":
    main()