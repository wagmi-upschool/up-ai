#!/usr/bin/env python3
"""
Clean up the extracted CSV data
"""

import pandas as pd
import re

def clean_service_names(text):
    """Clean up garbled service names"""
    if not text:
        return text
        
    # Fix common OCR issues
    replacements = {
        'ÜcrTeRtYi': 'Ücreti',
        'Y D a e p ğ ı i l ş a ik n l d iğ ır i m Ü a c , r e T t e i mdit': 'Yapılandırma, Taksitlendirme',
        'Para Çe': 'Para Çekme',
        '.1.1': 'Kategori 1.1',
        '.1.2': 'Kategori 1.2', 
        '.1.3': 'Kategori 1.3',
        '.2.1': 'Kategori 2.1',
        '.2.2': 'Kategori 2.2',
        '.2.3': 'Kategori 2.3',
        '.3.1': 'Kategori 3.1',
        '.3.2': 'Kategori 3.2',
        '.3.3': 'Kategori 3.3'
    }
    
    cleaned = text
    for old, new in replacements.items():
        cleaned = cleaned.replace(old, new)
    
    # Remove excessive dots at the beginning
    cleaned = re.sub(r'^\.+', '', cleaned)
    
    return cleaned

def main():
    # Read the CSV
    df = pd.read_csv('denizbank_tariff_data_v2.csv')
    
    # Clean service names
    df['Kalem_Adı'] = df['Kalem_Adı'].apply(clean_service_names)
    
    # Fill empty currency with TRY where we have amounts
    mask = (df['Para_Birimi'].isna() | (df['Para_Birimi'] == '')) & (df['Asgari_Tutar'].notna() & (df['Asgari_Tutar'] != ''))
    df.loc[mask, 'Para_Birimi'] = 'TRY'
    
    # Save cleaned version
    output_file = 'denizbank_tariff_cleaned.csv'
    df.to_csv(output_file, index=False, encoding='utf-8-sig')
    
    print(f"Cleaned data saved to {output_file}")
    print(f"Total rows: {len(df)}")
    print("\nSample of cleaned data:")
    print(df[['VegaSıraNo', 'RaporSıraNo', 'Kalem_Adı', 'Para_Birimi', 'Asgari_Tutar', 'Azami_Tutar']].head(10).to_string())

if __name__ == "__main__":
    main()