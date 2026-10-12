import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_TMP = Path(tempfile.mkdtemp(prefix="raglens-tests-"))
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["AUTO_SEED_EXPERIMENTS"] = "false"
os.environ["LLM_PROVIDER"] = "local"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["MLFLOW_TRACKING_URI"] = ""
os.environ["OTEL_ENABLED"] = "false"

import pytest  # noqa: E402

from app.evaluation.dataset import load_dataset  # noqa: E402


@pytest.fixture(scope="session")
def dataset():
    return load_dataset("sample_dataset")
