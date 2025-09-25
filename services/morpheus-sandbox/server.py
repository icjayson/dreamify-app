from datetime import datetime
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from schemas import AnalyzeRequest, AnalyzeResponse
from morpheus.workflows.analyze_csv.workflow import AnalyzeCSVWorkflow
from utils.logger import logger
from utils.health import check_health
import os
import json
from pathlib import Path

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_csv(request: AnalyzeRequest):
    """
    Analyze a CSV file and return chart recommendations
    """
    try:
        logger.info(f"Received analysis request for file: {request.file_path}")
        
        # Validate file exists
        file_path = os.path.join("storage/in", request.file_path)
        if not os.path.exists(file_path):
            logger.error(f"File not found: {request.file_path}")
            raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")
        
        # Initialize workflow
        workflow = AnalyzeCSVWorkflow()
        
        # Execute analysis
        logger.info("Starting workflow execution")
        result = workflow.execute(file_path, request.prompt)
        
        # Save workflow output to storage/out/
        output_dir = Path("storage/out")
        output_dir.mkdir(exist_ok=True)
        
        # Generate unique filename for this analysis
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = output_dir / f"workflow_{timestamp}.json"
        
        # Save complete workflow output if available
        if "workflow_output" in result and result["workflow_output"]:
            logger.info(f"Saving workflow output to: {output_file}")
            result["workflow_output"].save_to_file(str(output_file))
        else:
            # Fallback: save basic results
            logger.warning("No workflow output available, saving basic results")
            with open(output_file, 'w') as f:
                json.dump(result, f, indent=2)
        
        logger.info("Analysis completed successfully")
        
        return AnalyzeResponse(
            status="success",
            file_path=request.file_path,
            chart_recommendations=result.get("chart_recommendations", []),
            metrics=result.get("metrics", []),
            insights=result.get("insights", []),
            messages_saved_to=str(output_file)
        )
        
    except Exception as e:
        logger.error(f"Analysis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get("/health")
async def health():
    return await check_health()
