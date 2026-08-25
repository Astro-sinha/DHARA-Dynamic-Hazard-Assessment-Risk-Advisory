import sys
with open("test_out.txt", "w") as f:
    f.write(f"Python executable: {sys.executable}\n")
    f.write(f"Python version: {sys.version}\n")
print("Wrote to test_out.txt")
