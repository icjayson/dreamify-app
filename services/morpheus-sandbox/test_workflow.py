"""
Test script to verify the CSV analysis workflow
"""

import sys
import os
sys.path.append('/home/ducnpt/projects/morpheus')

from morpheus.workflows.analyze_csv.workflow import AnalyzeCSVWorkflow

def test_workflow():
    """Test the CSV analysis workflow with sample data"""
    
    workflow = AnalyzeCSVWorkflow()
    
    # Test with the existing sales_data.csv
    file_path = "/home/ducnpt/projects/morpheus/storage/in/sales_data.csv"
    user_prompt = "Analyze this sales data and recommend charts for visualization"
    
    print("Starting workflow test...")
    print(f"File: {file_path}")
    print(f"Prompt: {user_prompt}")
    print("-" * 50)
    
    try:
        result = workflow.execute(file_path, user_prompt)
        
        print("Analysis Results:")
        print(f"- Chart Recommendations: {len(result.get('chart_recommendations', []))}")
        print(f"- Insights: {len(result.get('insights', []))}")
        print(f"- Conversation History: {len(result.get('conversation_history', []))}")
        
        print("\nChart Recommendations:")
        for i, rec in enumerate(result.get('chart_recommendations', []), 1):
            print(f"{i}. {rec.get('chart_type', 'Unknown')} - Confidence: {rec.get('confidence', 0):.2f}")
            print(f"   Reasoning: {rec.get('reasoning', 'No reasoning provided')}")
        
        print("\nInsights:")
        for insight in result.get('insights', []):
            print(f"- {insight.get('description', 'No description')}")
        
        return True
        
    except Exception as e:
        print(f"Test failed with error: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_workflow()
    print(f"\nTest {'PASSED' if success else 'FAILED'}")