"""
API test script to test the /analyze endpoint
"""

import requests
import json

def test_api():
    """Test the /analyze API endpoint"""
    
    url = "http://localhost:8000/analyze"
    
    payload = {
        "file_path": "sales_data.csv",
        "prompt": "Please analyze this sales data and recommend appropriate charts for visualization"
    }
    
    print("Testing /analyze endpoint...")
    print(f"URL: {url}")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    print("-" * 50)
    
    try:
        response = requests.post(url, json=payload)
        
        if response.status_code == 200:
            result = response.json()
            print("✅ API call successful!")
            print(f"Status: {result.get('status')}")
            print(f"File: {result.get('file_path')}")
            print(f"Chart recommendations: {len(result.get('chart_recommendations', []))}")
            print(f"Metrics: {len(result.get('metrics', []))}")
            print(f"Insights: {len(result.get('insights', []))}")
            print(f"Results saved to: {result.get('messages_saved_to')}")
            
            print("\nChart Recommendations:")
            for i, rec in enumerate(result.get('chart_recommendations', []), 1):
                print(f"{i}. {rec.get('chart_type')} - {rec.get('title', 'No title')}")
                print(f"   Columns: {rec.get('columns', [])}")
                print(f"   X-axis: {rec.get('x_axis', 'None')}, Y-axis: {rec.get('y_axis', 'None')}")
                print(f"   Confidence: {rec.get('confidence', 0):.2f}")
                print(f"   Reasoning: {rec.get('reasoning', 'No reasoning')}")
            
            print("\nKey Metrics:")
            for i, metric in enumerate(result.get('metrics', []), 1):
                print(f"{i}. {metric.get('name', 'Unknown')}: {metric.get('value', 'N/A')}")
                print(f"   Type: {metric.get('type', 'Unknown')}")
                print(f"   Description: {metric.get('description', 'No description')}")
            
            return True
        else:
            print(f"❌ API call failed with status {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("❌ Could not connect to server. Make sure it's running on localhost:8000")
        return False
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return False

def test_health():
    """Test the /health endpoint"""
    
    try:
        response = requests.get("http://localhost:8000/health")
        if response.status_code == 200:
            print("✅ Health check passed")
            print(f"Response: {response.json()}")
            return True
        else:
            print(f"❌ Health check failed: {response.status_code}")
            return False
    except:
        print("❌ Could not reach health endpoint")
        return False

if __name__ == "__main__":
    print("=== Morpheus API Test ===\n")
    
    print("1. Testing health endpoint...")
    health_ok = test_health()
    
    if health_ok:
        print("\n2. Testing analyze endpoint...")
        analyze_ok = test_api()
        
        if analyze_ok:
            print("\n🎉 All tests passed!")
        else:
            print("\n❌ Analyze test failed")
    else:
        print("\n❌ Health check failed - server may not be running")
    
    print("\nTo start the server, run: ./start_server.sh")