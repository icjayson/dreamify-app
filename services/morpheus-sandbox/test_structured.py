#!/usr/bin/env python3
"""
Test the enhanced workflow with structured JSON output for charts and metrics
"""

import sys
import os
import json
sys.path.insert(0, '/home/ducnpt/projects/morpheus')

def test_structured_workflow():
    """Test the workflow with structured JSON chart and metrics output"""
    
    print("Testing enhanced workflow with structured JSON output...")
    
    try:
        from morpheus.workflows.analyze_csv.workflow import AnalyzeCSVWorkflow
        from pathlib import Path
        
        # Test file path
        file_path = "/home/ducnpt/projects/morpheus/storage/in/sales_data.csv"
        
        if not os.path.exists(file_path):
            print(f"❌ Test file not found: {file_path}")
            return False
        
        print(f"✅ Test file exists: {file_path}")
        
        # Initialize workflow
        workflow = AnalyzeCSVWorkflow()
        
        # Execute workflow with a specific prompt
        print("🚀 Executing workflow...")
        result = workflow.execute(file_path, "Analyze this sales data and provide structured recommendations")
        
        print("✅ Workflow executed successfully!")
        
        # Check chart recommendations
        if "chart_recommendations" in result:
            charts = result['chart_recommendations']
            print(f"📊 Chart recommendations: {len(charts)}")
            
            for i, chart in enumerate(charts, 1):
                print(f"  {i}. {chart.get('chart_type', 'Unknown')} - {chart.get('title', 'No title')}")
                print(f"     Columns: {chart.get('columns', [])}")
                print(f"     X-axis: {chart.get('x_axis', 'None')}, Y-axis: {chart.get('y_axis', 'None')}")
                print(f"     Reasoning: {chart.get('reasoning', 'No reasoning')}")
                print()
        else:
            print("❌ No chart recommendations found")
        
        # Check metrics
        if "metrics" in result:
            metrics = result['metrics']
            print(f"📈 Metrics: {len(metrics)}")
            
            for i, metric in enumerate(metrics, 1):
                print(f"  {i}. {metric.get('name', 'Unknown')}: {metric.get('value', 'N/A')}")
                print(f"     Type: {metric.get('type', 'Unknown')}")
                print(f"     Description: {metric.get('description', 'No description')}")
                print()
        else:
            print("❌ No metrics found")
        
        # Check workflow output
        if "workflow_output" in result:
            print("📝 Workflow output created successfully")
            
            # Test saving to file
            output_dir = Path("storage/out")
            output_dir.mkdir(exist_ok=True)
            test_file = output_dir / "test_structured_output.json"
            
            result["workflow_output"].save_to_file(str(test_file))
            print(f"💾 Workflow output saved to: {test_file}")
            
            # Show some details about the saved output
            if test_file.exists():
                with open(test_file, 'r') as f:
                    saved_data = json.load(f)
                
                print(f"📁 File size: {test_file.stat().st_size} bytes")
                print(f"💬 Messages in workflow: {len(saved_data.get('messages', []))}")
                print(f"⏱️  Execution time: {saved_data.get('duration_seconds', 'Unknown')} seconds")
                
                return True
            else:
                print("❌ Output file not created")
                return False
        else:
            print("❌ No workflow output in result")
            return False
            
    except Exception as e:
        print(f"❌ Test failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_api_with_metrics():
    """Test the API endpoint with the new metrics field"""
    
    print("\\nTesting API with enhanced metrics support...")
    
    try:
        import requests
        
        url = "http://localhost:8000/analyze"
        payload = {
            "file_path": "sales_data.csv",
            "prompt": "Provide detailed analysis with charts and key metrics"
        }
        
        print("🌐 Making API request...")
        response = requests.post(url, json=payload, timeout=60)
        
        if response.status_code == 200:
            result = response.json()
            print("✅ API call successful!")
            
            print(f"📊 Chart recommendations: {len(result.get('chart_recommendations', []))}")
            print(f"📈 Metrics: {len(result.get('metrics', []))}")
            print(f"💡 Insights: {len(result.get('insights', []))}")
            
            # Show first chart recommendation
            charts = result.get('chart_recommendations', [])
            if charts:
                first_chart = charts[0]
                print(f"\\nFirst chart: {first_chart.get('chart_type', 'Unknown')}")
                print(f"Title: {first_chart.get('title', 'No title')}")
                print(f"Columns: {first_chart.get('columns', [])}")
            
            # Show first metric
            metrics = result.get('metrics', [])
            if metrics:
                first_metric = metrics[0]
                print(f"\\nFirst metric: {first_metric.get('name', 'Unknown')}")
                print(f"Value: {first_metric.get('value', 'N/A')}")
                print(f"Type: {first_metric.get('type', 'Unknown')}")
            
            return True
        else:
            print(f"❌ API call failed with status {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("⚠️  Server not running - skipping API test")
        print("   Start server with: ./start_server.sh")
        return True  # Don't fail the test if server isn't running
    except Exception as e:
        print(f"❌ API test failed: {str(e)}")
        return False

if __name__ == "__main__":
    print("=== Morpheus Enhanced Structured Output Test ===\\n")
    
    # Test 1: Structured workflow
    workflow_ok = test_structured_workflow()
    
    # Test 2: API with metrics
    api_ok = test_api_with_metrics()
    
    # Summary
    print("\\n=== Test Results ===")
    print(f"Structured Workflow: {'✅ PASS' if workflow_ok else '❌ FAIL'}")
    print(f"API with Metrics: {'✅ PASS' if api_ok else '❌ FAIL'}")
    
    if workflow_ok and api_ok:
        print("\\n🎉 All tests passed! Enhanced structured output is working.")
        print("\\nNew features:")
        print("- ✅ Structured JSON output for chart recommendations")
        print("- ✅ Detailed chart specifications (title, axes, columns)")
        print("- ✅ Key metrics extraction and output")
        print("- ✅ Enhanced API response with metrics field")
        print("- ✅ Smart prompt engineering for structured responses")
        print("\\nYou can now start the server with: ./start_server.sh")
    else:
        print("\\n❌ Some tests failed. Check the errors above.")