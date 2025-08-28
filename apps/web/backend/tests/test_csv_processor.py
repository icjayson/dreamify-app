from app.core.analytics import CSVProcessor

def test_csv_upload():
    processor = CSVProcessor()
    # Call the main entry point
    result = processor.upload_and_process("sample.csv")

    # Show results
    print("\n--- Processed Data Preview ---")
    print(result["data_preview"])   # first 5 rows
    
    print("\n--- Column Analysis ---")
    for col, info in result["column_analysis"].items():
        print(f"{col}: {info}")
    
    print("\n--- Business Metrics Detected ---")
    print(result["business_metrics"])
    
    print("\n--- Suggested Visualizations ---")
    print(result["suggested_visualizations"])
    
    print("\n--- Processing Stats ---")
    print(result["processing_stats"])

if __name__ == "__main__":
    test_csv_upload()
