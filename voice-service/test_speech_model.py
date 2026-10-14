import unittest
import os
from pathlib import Path
from unittest.mock import Mock, patch

from speech_model import DeferredConverter, load_speech_model

os.environ.setdefault("HF_HOME", str(Path(__file__).resolve().parent / ".cache" / "huggingface"))


class DeferredTokenizerTests(unittest.TestCase):
    def test_unused_language_does_not_initialize_or_download_assets(self):
        factory = Mock(side_effect=RuntimeError("Download must not run"))
        converter = DeferredConverter(factory, "model-directory")
        self.assertIsNone(converter.instance)
        factory.assert_not_called()

    def test_converter_initializes_once_if_its_language_is_requested(self):
        native = Mock(side_effect=lambda text: f"converted:{text}")
        factory = Mock(return_value=native)
        converter = DeferredConverter(factory, "model-directory")
        self.assertEqual(converter("first"), "converted:first")
        self.assertEqual(converter("second"), "converted:second")
        factory.assert_called_once_with("model-directory")

    def test_upstream_factory_is_restored_when_model_loading_fails(self):
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        from chatterbox.models.tokenizers import tokenizer
        original = tokenizer.ChineseCangjieConverter
        with patch.object(ChatterboxMultilingualTTS, "from_pretrained", side_effect=RuntimeError("loading failed")):
            with self.assertRaisesRegex(RuntimeError, "loading failed"):
                load_speech_model("cpu")
        self.assertIs(tokenizer.ChineseCangjieConverter, original)


if __name__ == "__main__":
    unittest.main()
