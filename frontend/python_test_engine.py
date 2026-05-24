import sys
import json
import pandas as pd

df = pd.DataFrame({
    "a": range(1000),
    "b": range(1000, 2000)
})

def send(msg):
    print(json.dumps(msg), flush=True)

def send_preview():
    preview = df.head(100)

    send({
        "type": "preview",
        "columns": preview.columns.tolist(),
        "rows": preview.values.tolist()
    })

send_preview()

# keep process alive (important for VS Code integration later)
while True:
    pass