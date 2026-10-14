"""Worker boundary tests, with no downloads or speech model execution."""
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
import app as worker


def wav(seconds, amplitude=0.1):
    samples = amplitude * np.sin(2 * np.pi * 220 * np.arange(int(24000 * seconds)) / 24000)
    data = io.BytesIO()
    sf.write(data, samples, 24000, format="WAV")
    return data.getvalue()


class VoiceWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [patch.object(worker, "TOKEN", "test-secret-at-least-24-characters"),
                        patch.object(worker, "REFERENCE", Path(self.temp.name) / "reference.wav"),
                        patch.object(worker, "models", {})]
        for item in self.patches:
            item.start()
        self.client = TestClient(worker.app)
        self.headers = {"Authorization": "Bearer test-secret-at-least-24-characters"}

    def tearDown(self):
        self.client.close()
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def upload(self, content):
        return self.client.post("/reference", headers=self.headers, files={"audio": ("recording.wav", content, "audio/wav")})

    def test_worker_requires_its_private_secret(self):
        self.assertEqual(self.client.get("/health").status_code, 401)
        self.assertFalse(self.client.get("/health", headers=self.headers).json()["ready"])

    def test_reference_rejects_short_quiet_and_invalid_audio(self):
        for sample in [wav(1), wav(6, 0), b"not audio"]:
            self.assertEqual(self.upload(sample).status_code, 422)
        self.assertFalse(worker.REFERENCE.exists())

    def test_reference_rejects_overlong_audio_after_decode(self):
        self.assertEqual(self.upload(wav(31)).status_code, 422)
        self.assertFalse(worker.REFERENCE.exists())

    def test_reference_is_normalized_and_kept_private(self):
        response = self.upload(wav(6))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["referenceReady"])
        self.assertEqual(sf.info(worker.REFERENCE).samplerate, 24000)
        status = self.client.get("/health", headers=self.headers).json()
        self.assertTrue(status["referenceReady"])
        self.assertFalse(status["ready"])
        self.assertEqual(self.client.get("/data/reference.wav", headers=self.headers).status_code, 404)

    def test_speech_cannot_run_without_loaded_models(self):
        response = self.client.post("/speech", headers=self.headers, json={"text": "Hello"})
        self.assertEqual(response.status_code, 503)

    def test_model_work_has_bounded_concurrency(self):
        worker.model_lock.acquire()
        try:
            with self.assertRaises(worker.HTTPException) as caught:
                worker.exclusive(lambda: "never runs")
            self.assertEqual(caught.exception.status_code, 429)
        finally:
            worker.model_lock.release()


if __name__ == "__main__":
    unittest.main()
