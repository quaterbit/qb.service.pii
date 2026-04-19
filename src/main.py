from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI()


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/")
def root():
    return {"service": "qb.service.pii", "status": "running"}


@app.get("/api/info")
def info():
    return {
        "service": "qb.service.pii",
        "version": "0.1.0",
        "environment": "production",
    }
