#!/usr/bin/env python3
"""
Simple test script for the simplified workflow (Python REPL only)
"""

import sys
import os
import json

# Add the project root to Python path
sys.path.insert(0, '/home/ducnpt/projects/morpheus')

def test_python_repl_csv_loading():
    """Test CSV loading with Python REPL tool directly"""
    
    from morpheus.tools.python_repl.tool import python_tool
    
    print("Testing Python REPL for CSV loading...")
    
    # Test CSV loading code
    csv_code = """
import pandas as pd
import numpy as np

# Load the sample CSV file
df = pd.read_csv('/home/ducnpt/projects/morpheus/storage/in/sales_data.csv')

print("=== DATASET OVERVIEW ===")
print("Dataset Shape:", df.shape)
print("\\nColumn Names and Types:")
print(df.dtypes)
print("\\nFirst few rows:")
print(df.head())
print("\\nBasic statistics:")
print(df.describe(include='all'))
print("\\nMissing values:")
print(df.isnull().sum())
"""
    
    try:
        result = python_tool.run(csv_code)
        print("✅ Python REPL CSV loading successful!")
        print("Output:")
        print("-" * 50)
        print(result)
        print("-" * 50)
        return True
    except Exception as e:
        print(f"❌ Python REPL CSV loading failed: {str(e)}")
        return False

def test_chart_knowledge_tool():
    """Test the chart knowledge tool"""
    
    from morpheus.tools.charts_knowledge.tool import get_available_chart_types
    
    print("\\nTesting chart knowledge tool...")
    
    try:
        result = get_available_chart_types.invoke({})
        print("✅ Chart knowledge tool working!")
        print("Available chart types:")
        print(result[:500] + "..." if len(result) > 500 else result)
        return True
    except Exception as e:
        print(f"❌ Chart knowledge tool failed: {str(e)}")
        return False

def test_simplified_workflow():
    """Test the simplified workflow"""
    
    print("\\nTesting simplified workflow...")
    
    try:
        from morpheus.workflows.analyze_csv.workflow import AnalyzeCSVWorkflow
        
        workflow = AnalyzeCSVWorkflow()
        print("✅ Workflow initialized successfully!")
        
        # Test basic structure
        print(f"Number of tools: {len(workflow.tools)}")
        print(f"Tools: {[tool.name for tool in workflow.tools]}")
        
        return True
    except Exception as e:
        print(f"❌ Workflow initialization failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("=== Morpheus Simplified Implementation Test ===\\n")
    
    # Test 1: Python REPL CSV loading
    test1_ok = test_python_repl_csv_loading()
    
    # Test 2: Chart knowledge tool
    test2_ok = test_chart_knowledge_tool()
    
    # Test 3: Simplified workflow
    test3_ok = test_simplified_workflow()
    
    # Summary
    print("\\n=== Test Results ===")
    print(f"Python REPL CSV loading: {'✅ PASS' if test1_ok else '❌ FAIL'}")
    print(f"Chart knowledge tool: {'✅ PASS' if test2_ok else '❌ FAIL'}")
    print(f"Simplified workflow: {'✅ PASS' if test3_ok else '❌ FAIL'}")
    
    if all([test1_ok, test2_ok, test3_ok]):
        print("\\n🎉 All tests passed! The simplified implementation is working.")
        print("\\nYou can now start the server with: ./start_server.sh")
    else:
        print("\\n❌ Some tests failed. Check the errors above.")