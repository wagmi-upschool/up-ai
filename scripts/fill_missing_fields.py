#!/usr/bin/env python3
"""
Fill missing VegaSıraNo fields based on the pattern described
"""

import pandas as pd
import re

def fill_missing_vega_fields(df):
    """Fill missing VegaSıraNo fields according to the pattern"""
    
    # Create a copy to work with
    df_filled = df.copy()
    
    # Fill missing VegaSıraNo based on the pattern
    current_vega = ""
    
    for i, row in df_filled.iterrows():
        # If we have a VegaSıraNo, use it and store it
        if pd.notna(row['VegaSıraNo']) and row['VegaSıraNo'].strip():
            current_vega = row['VegaSıraNo'].strip()
        # If we don't have one but we have a stored one, use the stored one
        elif current_vega:
            df_filled.at[i, 'VegaSıraNo'] = current_vega
    
    return df_filled

def create_proper_mapping():
    """Create the proper mapping based on the specific pattern mentioned"""
    
    # Read the current CSV
    df = pd.read_csv('denizbank_tariff_complete.csv')
    
    # Manual fixes based on the specific pattern mentioned
    # RaporSıraNo 1 should be 1.1.1 'Kredi Tahsis'
    # RaporSıraNo 2 should be 1.1.1 'Kredi Kullandırım'
    
    fixes = [
        # RaporSıraNo 1 and 2 should both be 1.1.1
        {'rapor': '1', 'vega': '1.1.1', 'service': 'Kredi Tahsis Ücreti'},
        {'rapor': '2', 'vega': '1.1.1', 'service': 'Kredi Kullandırım Ücreti'},
        # Add other specific fixes as needed
    ]
    
    # Apply manual fixes
    for fix in fixes:
        mask = df['RaporSıraNo'].astype(str) == fix['rapor']
        if mask.any():
            df.loc[mask, 'VegaSıraNo'] = fix['vega']
            if fix['service'] and (df.loc[mask, 'Kalem_Adı'].isna().any() or (df.loc[mask, 'Kalem_Adı'] == '').any()):
                df.loc[mask, 'Kalem_Adı'] = fix['service']
    
    # Now fill missing fields using the general pattern
    df_final = fill_missing_vega_fields(df)
    
    return df_final

def analyze_and_fix_csv():
    """Analyze the current CSV and create a better version"""
    
    # First, let's see what we have
    df = pd.read_csv('denizbank_tariff_complete.csv')
    
    print("Current data sample:")
    print(df[['RaporSıraNo', 'VegaSıraNo', 'Kalem_Adı']].head(20).to_string())
    
    print(f"\nRows with empty VegaSıraNo: {df['VegaSıraNo'].isna().sum()}")
    print(f"Rows with empty Kalem_Adı: {df['Kalem_Adı'].isna().sum()}")
    
    # Get all entries with RaporSıraNo 1 and 2
    rapor_1_2 = df[df['RaporSıraNo'].isin(['1', '2'])]
    print(f"\nEntries with RaporSıraNo 1 and 2:")
    print(rapor_1_2[['RaporSıraNo', 'VegaSıraNo', 'Kalem_Adı']].to_string())
    
    # Apply the fixes
    df_fixed = create_proper_mapping()
    
    # Save the improved version
    output_file = 'denizbank_tariff_final.csv'
    df_fixed.to_csv(output_file, index=False, encoding='utf-8-sig')
    
    print(f"\nFixed data saved to {output_file}")
    print(f"Total rows: {len(df_fixed)}")
    
    # Show the fixed entries
    rapor_1_2_fixed = df_fixed[df_fixed['RaporSıraNo'].isin(['1', '2'])]
    print(f"\nFixed entries with RaporSıraNo 1 and 2:")
    print(rapor_1_2_fixed[['RaporSıraNo', 'VegaSıraNo', 'Kalem_Adı']].to_string())
    
    # Show sample of all data
    print(f"\nSample of fixed data:")
    print(df_fixed[['RaporSıraNo', 'VegaSıraNo', 'Kalem_Adı']].head(15).to_string())

if __name__ == "__main__":
    analyze_and_fix_csv()