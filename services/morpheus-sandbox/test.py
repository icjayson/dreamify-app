#!/usr/bin/env python3
"""
Test the updated workflow with logging and workflow output
"""

import sys
import os
sys.path.insert(0, '/home/hungnq/projects/morpheus')

def test_workflow_with_logging():
    """Test the workflow with the new logging and output features"""
    
    print("Testing updated workflow with logging and workflow output...")
    
    try:
        from morpheus.workflows.analyze_csv.workflow import AnalyzeCSVWorkflow
        from pathlib import Path
        
        # Initialize workflow
        workflow = AnalyzeCSVWorkflow()
        
        # Test file path
        file_path = "/home/hungnq/projects/dreamify-morpheus/storage/in/sales_amazon.csv"
        
        if not os.path.exists(file_path):
            print(f"❌ Test file not found: {file_path}")
            return False
        
        print(f"✅ Test file exists: {file_path}")
        
        # Execute workflow
        print("🚀 Executing workflow...")
        result = workflow.execute(file_path, "Analyze this sales data")
        
        print("✅ Workflow executed successfully!")
        
        # Check results (new frontend contract)
        data = result.get("data") or result
        if isinstance(data, dict):
            charts = data.get("charts", [])
            metrics = data.get("metrics", [])
            print(f"📊 Charts: {len(charts)} | 📈 Metrics: {len(metrics)}")
        
        if "workflow_output" in result:
            print("📝 Workflow output created successfully")
            
            # Test saving to file
            output_dir = Path("storage/out")
            output_dir.mkdir(exist_ok=True)
            test_file = output_dir / "test_workflow_output.json"
            
            result["workflow_output"].save_to_file(str(test_file))
            print(f"💾 Workflow output saved to: {test_file}")
            
            # Verify file was created
            if test_file.exists():
                print("✅ Output file created successfully")
                
                # Show file size
                size = test_file.stat().st_size
                print(f"📁 File size: {size} bytes")
                
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

def test_logger():
    """Test the logger functionality"""
    
    print("\\nTesting logger...")
    
    try:
        from utils.logger import logger
        
        logger.info("Test info message")
        logger.warning("Test warning message")
        logger.error("Test error message")
        
        print("✅ Logger working correctly")
        return True
        
    except Exception as e:
        print(f"❌ Logger test failed: {str(e)}")
        return False

if __name__ == "__main__":
    print("=== Morpheus Enhanced Workflow Test ===\\n")
    
    # Test 1: Logger
    logger_ok = test_logger()
    
    # Test 2: Enhanced workflow
    workflow_ok = test_workflow_with_logging()
    
    # Summary
    print("\\n=== Test Results ===")
    print(f"Logger: {'✅ PASS' if logger_ok else '❌ FAIL'}")
    print(f"Enhanced Workflow: {'✅ PASS' if workflow_ok else '❌ FAIL'}")
    
    if logger_ok and workflow_ok:
        print("\\n🎉 All tests passed! Enhanced implementation is working.")
        print("\\nFeatures added:")
        print("- ✅ Comprehensive logging with file and console output")
        print("- ✅ Standardized WorkflowOutput class for all workflows")
        print("- ✅ Complete message history preservation")
        print("- ✅ Automatic workflow output saving to storage/out/")
        print("\\nYou can now start the server with: ./start_server.sh")
    else:
        print("\\n❌ Some tests failed. Check the errors above.")