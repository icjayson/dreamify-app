from langchain_experimental.tools.python.tool import PythonREPLTool

from langchain.tools import BaseTool
import code

class PersistentPythonREPLTool(BaseTool):
    name: str = "python_repl"
    description: str = "A persistent Python REPL session."

    def __init__(self):
        super().__init__()
        self.locals = {}
        self.interpreter = code.InteractiveInterpreter(self.locals)

    def _run(self, query: str, **kwargs) -> str:
        try:
            self.interpreter.runsource(query)
            return str(self.locals)
        except Exception as e:
            return f"Error: {e}"

    async def _arun(self, query: str, **kwargs):
        raise NotImplementedError
