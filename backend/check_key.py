import os
from dotenv import load_dotenv

load_dotenv()
key = os.getenv("GEMINI_API_KEY")

print("Key found:", key is not None)
if key:
    print("Length:", len(key))
    print("Starts with AIza:", key.startswith("AIza"))
    print("Has leading/trailing whitespace:", key != key.strip())
    print("Repr (shows hidden chars):", repr(key[:6]) + "..." + repr(key[-4:]))
else:
    print("GEMINI_API_KEY was not found. Check that .env exists in this folder and has that exact variable name.")