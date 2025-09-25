from langchain_experimental.tools.python.tool import PythonREPLTool

repl = PythonREPLTool()
print(repl.run("print(100 + 2)"))   # prints 102
print(repl.run("x = 1 + 2"))        # nothing printed
print(repl.run("print(x)"))         # prints 3
print(repl.run("x = x * 10"))       # nothing printed
print(repl.run("print(x)"))         # prints 30
print(repl.run("for i in range(1, x, 5):\n  print(i)"))         # prints 30

