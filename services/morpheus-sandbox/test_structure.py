#!/usr/bin/env python3
"""
Simple test without dependencies - just test the structure
"""

import sys
import os

# Add the project root to Python path
sys.path.insert(0, '/home/ducnpt/projects/morpheus')

def test_imports():
    """Test basic imports"""
    
    print("Testing basic imports...")
    
    try:
        # Test chart types
        from morpheus.knowledge.charts.chart_types import CHART_TYPES
        print(f"✅ Chart types loaded: {len(CHART_TYPES)} chart types available")
        
        # Show chart types
        for chart_id, info in CHART_TYPES.items():
            print(f"  - {chart_id}: {info['name']}")
        
        return True
    except Exception as e:
        print(f"❌ Import failed: {str(e)}")
        return False

def test_file_structure():
    """Test that required files exist"""
    
    print("\\nTesting file structure...")
    
    required_files = [
        '/home/ducnpt/projects/morpheus/server.py',
        '/home/ducnpt/projects/morpheus/schemas.py',
        '/home/ducnpt/projects/morpheus/morpheus/knowledge/charts/chart_types.py',
        '/home/ducnpt/projects/morpheus/morpheus/tools/charts_knowledge/tool.py',
        '/home/ducnpt/projects/morpheus/morpheus/workflows/analyze_csv/workflow.py',
        '/home/ducnpt/projects/morpheus/storage/in/sales_data.csv'
    ]
    
    all_exist = True
    for file_path in required_files:
        if os.path.exists(file_path):
            print(f"✅ {file_path}")
        else:
            print(f"❌ {file_path}")
            all_exist = False
    
    return all_exist

if __name__ == "__main__":
    print("=== Morpheus Simplified Structure Test ===\\n")
    
    # Test 1: Basic imports
    test1_ok = test_imports()
    
    # Test 2: File structure
    test2_ok = test_file_structure()
    
    # Summary
    print("\\n=== Test Results ===")
    print(f"Basic imports: {'✅ PASS' if test1_ok else '❌ FAIL'}")
    print(f"File structure: {'✅ PASS' if test2_ok else '❌ FAIL'}")
    
    if test1_ok and test2_ok:
        print("\\n🎉 Basic structure is working!")
        print("\\nNext steps:")
        print("1. Install dependencies: pip install -r requirements.txt")
        print("2. Set up OpenAI API key in config/config.yaml")
        print("3. Test the full workflow")
    else:
        print("\\n❌ Some basic tests failed. Check the errors above.")