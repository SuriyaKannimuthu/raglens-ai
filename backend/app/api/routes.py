from fastapi import APIRouter

from app.api import dashboard, datasets, evaluations, experiments, monitoring, playground, system

api_router = APIRouter()
for module in (system, datasets, evaluations, experiments, playground, monitoring, dashboard):
    api_router.include_router(module.router)
